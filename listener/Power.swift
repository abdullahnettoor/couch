import Foundation
import IOKit.pwr_mgt

enum PowerState: String { case off, starting, on }

/// Raw loopback helpers. Blocking, but loopback answers (or refuses) at once.
enum Loopback {
  static func connect(_ port: UInt16, timeout: Int = 2) -> Int32? {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return nil }
    var tv = timeval(tv_sec: timeout, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let ok = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    if ok != 0 {
      close(fd)
      return nil
    }
    return fd
  }

  static func isOpen(_ port: UInt16) -> Bool {
    guard let fd = connect(port) else { return false }
    close(fd)
    return true
  }

  static func postQuit(port: UInt16, token: String) {
    guard let fd = connect(port, timeout: 3) else { return }
    defer { close(fd) }
    let req =
      "POST /local/quit HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nAuthorization: Bearer \(token)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    _ = req.withCString { write(fd, $0, strlen($0)) }
    var scratch = [UInt8](repeating: 0, count: 256)
    _ = read(fd, &scratch, scratch.count)
  }

  /// The pid listening on the port, via lsof.
  static func listeningPid(_ port: UInt16) -> pid_t? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    p.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return nil }
    let out = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(decoding: out, as: UTF8.self).split(separator: "\n").first.flatMap { pid_t($0) }
  }
}

/// off / starting / on, and what moves between them.
final class Power {
  private let q: DispatchQueue
  private let cfg: Config
  private let token: String
  private var timer: DispatchSourceTimer?
  private(set) var state = PowerState.off
  private var pid: pid_t?
  private var deadline = Date.distantFuture
  private var stopping = false
  private var terminated = false

  /// Called on `q` for every change. `failed` is true when a start timed out.
  var onChange: ((PowerState, Bool) -> Void)?

  init(q: DispatchQueue, cfg: Config, token: String) {
    self.q = q
    self.cfg = cfg
    self.token = token
  }

  func start() {
    let t = DispatchSource.makeTimerSource(queue: q)
    t.setEventHandler { [weak self] in self?.tick() }
    timer = t
    t.resume()
    reschedule()
    tick()
  }

  private func reschedule() {
    let busy = state == .starting || stopping
    let interval = busy ? 0.25 : 2.0
    timer?.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(busy ? 50 : 500))
  }

  private func set(_ s: PowerState, failed: Bool = false) {
    guard s != state || failed else { return }
    state = s
    if s != .on {
      pid = nil
      stopping = false
    }
    reschedule()
    log("state \(s.rawValue)")
    onChange?(s, failed)
  }

  func toggle() {
    switch state {
    case .off: launch()
    case .starting: break
    case .on: quit()
    }
  }

  private func launch() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/sh")
    p.arguments = ["-c", cfg.launch]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else {
      set(.off, failed: true)
      return
    }
    deadline = Date().addingTimeInterval(cfg.startTimeout)
    set(.starting)
    wakeDisplay()
  }

  private func wakeDisplay() {
    var id = IOPMAssertionID(0)
    IOPMAssertionDeclareUserActivity("Couch power on" as CFString, kIOPMUserActiveLocal, &id)
  }

  private func quit() {
    guard !stopping else { return }
    stopping = true
    terminated = false
    deadline = Date().addingTimeInterval(10)
    reschedule()
    let port = cfg.appPort
    let token = token
    DispatchQueue.global().async { Loopback.postQuit(port: port, token: token) }
  }

  private func alive() -> Bool {
    guard let pid else { return false }
    return kill(pid, 0) == 0 || errno == EPERM
  }

  private func becomeOn() {
    set(.on)
    let port = cfg.appPort
    DispatchQueue.global().async { [weak self] in
      let found = Loopback.listeningPid(port)
      self?.q.async { if self?.state == .on { self?.pid = found } }
    }
  }

  /// A proxy couldn't reach the app: look again now instead of waiting for the next tick.
  func checkNow() { tick() }

  private func tick() {
    let open = Loopback.isOpen(cfg.appPort)
    switch state {
    case .off:
      if open { becomeOn() }
    case .starting:
      if open {
        becomeOn()
      } else if Date() > deadline {
        set(.off, failed: true)
      }
    case .on:
      if stopping {
        if !open && !alive() {
          set(.off)
        } else if Date() > deadline {
          if let pid, !terminated {
            kill(pid, SIGTERM)
            terminated = true
            deadline = Date().addingTimeInterval(2)
          } else {
            set(.off)
          }
        }
      } else if !open || (pid != nil && !alive()) {
        set(.off)
      }
    }
  }
}

/// Keeps the Mac from idle sleep (the display may still sleep).
func holdAwakeAssertion() {
  var id = IOPMAssertionID(0)
  IOPMAssertionCreateWithName(
    kIOPMAssertPreventUserIdleSystemSleep as CFString,
    IOPMAssertionLevel(kIOPMAssertionLevelOn),
    "Couch Listener keeps Couch reachable" as CFString,
    &id)
}
