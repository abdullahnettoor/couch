import Foundation
import Network

struct Head {
  let method: String
  let target: String
  let headers: [String: String]

  var path: String { String(target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "") }
  var key: String? {
    let parts = target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }
    for pair in parts[1].split(separator: "&") {
      let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      if kv.count == 2, kv[0] == "key" { return String(kv[1]).removingPercentEncoding }
    }
    return nil
  }
  var isWebSocket: Bool { headers["upgrade"]?.lowercased() == "websocket" && path == "/ws" }

  static func parse(_ raw: Data) -> Head? {
    let lines = String(decoding: raw, as: UTF8.self).components(separatedBy: "\r\n")
    let first = lines[0].split(separator: " ")
    guard first.count >= 2 else { return nil }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let colon = line.firstIndex(of: ":") else { continue }
      headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    return Head(method: String(first[0]), target: String(first[1]), headers: headers)
  }
}

protocol Session: AnyObject {
  func cancel()
}

final class Server {
  private let q: DispatchQueue
  private let cfg: Config
  private let power: Power
  private let pairing: Pairing
  private var listener: NWListener?
  private var sessions: [ObjectIdentifier: Session] = [:]
  private var phones: [ObjectIdentifier: PhoneSocket] = [:]
  private var proxies: [ObjectIdentifier: Session] = [:]
  /// Connections that haven't sent a full request head yet, oldest first.
  private var pending: [Incoming] = []
  static let maxPending = 32

  init(q: DispatchQueue, cfg: Config, power: Power, pairing: Pairing) {
    self.q = q
    self.cfg = cfg
    self.power = power
    self.pairing = pairing
    pairing.onChange = { [weak self] in self?.revokeAll() }
    power.onChange = { [weak self] state, failed in self?.powerChanged(state, failed: failed) }
  }

  func start(ready: @escaping () -> Void, failed: @escaping () -> Void) {
    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true
    guard let port = NWEndpoint.Port(rawValue: cfg.publicPort), let l = try? NWListener(using: params, on: port) else {
      return failed()
    }
    l.stateUpdateHandler = { state in
      switch state {
      case .ready: ready()
      case .failed: failed()
      default: break
      }
    }
    l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
    listener = l
    l.start(queue: q)
  }

  func tickPairing() { pairing.refresh() }

  /// The key changed: nobody authenticated with the old one stays connected.
  private func revokeAll() {
    for p in Array(phones.values) { p.cancel() }
    for p in Array(proxies.values) { p.cancel() }
  }

  // MARK: power

  private func powerChanged(_ state: PowerState, failed: Bool) {
    let message = "{\"type\":\"power\",\"state\":\"\(state.rawValue)\"" + (failed ? ",\"failed\":true}" : "}")
    for p in phones.values {
      p.send(WS.text(message))
      // Phones on the listener's own socket reconnect, and land on Couch once it's on.
      if state == .on { p.closeSoon() }
    }
    if state == .off { for p in proxies.values { p.cancel() } }
  }

  // MARK: connections

  private func accept(_ conn: NWConnection) {
    while pending.count >= Server.maxPending { pending[0].cancel() }
    let s = Incoming(conn: conn, server: self, q: q, timeout: cfg.headerTimeout)
    sessions[ObjectIdentifier(s)] = s
    pending.append(s)
    s.start()
  }

  fileprivate func finished(_ s: Session) {
    let id = ObjectIdentifier(s)
    sessions[id] = nil
    pending.removeAll { $0 === s }
    phones[id] = nil
    proxies[id] = nil
  }

  fileprivate func route(_ s: Incoming, head: Head, raw: Data) {
    let conn = s.conn
    pending.removeAll { $0 === s }
    if head.isWebSocket {
      guard pairing.accepts(head.key), let key = head.key, let clientKey = head.headers["sec-websocket-key"] else {
        return s.respond(status: "401 Unauthorized")
      }
      if power.state == .on { return proxy(s, raw: raw, websocket: true, key: key) }
      let reply =
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(WS.accept(for: clientKey))\r\n\r\n"
      let phone = PhoneSocket(conn: conn, server: self, power: power, pairing: pairing, key: key, q: q)
      sessions[ObjectIdentifier(s)] = nil
      sessions[ObjectIdentifier(phone)] = phone
      phones[ObjectIdentifier(phone)] = phone
      conn.send(content: Data(reply.utf8), completion: .contentProcessed { _ in })
      phone.send(WS.text("{\"type\":\"power\",\"state\":\"\(power.state.rawValue)\"}"))
      phone.start()
      return
    }
    if power.state == .on { return proxy(s, raw: raw, websocket: false, key: nil) }
    guard head.method == "GET" else { return s.respond(status: "404 Not Found") }
    switch head.path {
    case "/":
      s.respond(file: cfg.page, type: "text/html; charset=utf-8", cache: "no-store", unpaired: !pairing.isPaired)
    case "/icon.png":
      s.respond(file: cfg.icons + "/icon-192.png", type: "image/png", cache: "public, max-age=86400")
    case "/icon-512.png":
      s.respond(file: cfg.icons + "/icon-512.png", type: "image/png", cache: "public, max-age=86400")
    case "/manifest.webmanifest":
      s.respond(file: cfg.icons + "/manifest.webmanifest", type: "application/manifest+json; charset=utf-8", cache: "no-store")
    case "/touch-icon.png":
      s.respond(file: cfg.icons + "/touch-icon.png", type: "image/png", cache: "public, max-age=86400")
    case "/mark.png":
      s.respond(file: cfg.icons + "/mark-256.png", type: "image/png", cache: "public, max-age=86400")
    case "/mark-32.png":
      s.respond(file: cfg.icons + "/mark-32.png", type: "image/png", cache: "public, max-age=86400")
    default:
      s.respond(status: "404 Not Found")
    }
  }

  private func proxy(_ s: Incoming, raw: Data, websocket: Bool, key: String?) {
    let p = Proxy(
      client: s.conn, appPort: cfg.appPort, head: raw, websocket: websocket, server: self, power: power, pairing: pairing,
      key: key, q: q)
    sessions[ObjectIdentifier(s)] = nil
    sessions[ObjectIdentifier(p)] = p
    proxies[ObjectIdentifier(p)] = p
    p.start()
  }
}

/// Reads one request head, then hands over.
final class Incoming: Session {
  let conn: NWConnection
  private unowned let server: Server
  private let q: DispatchQueue
  private var buffer = Data()
  private var done = false
  private let timeout: Double
  private var deadline: DispatchWorkItem?

  init(conn: NWConnection, server: Server, q: DispatchQueue, timeout: Double) {
    self.conn = conn
    self.server = server
    self.q = q
    self.timeout = timeout
  }

  func start() {
    conn.stateUpdateHandler = { [weak self] state in
      if case .failed = state { self?.cancel() }
    }
    let item = DispatchWorkItem { [weak self] in
      guard let self, !self.done else { return }
      self.cancel()
    }
    deadline = item
    q.asyncAfter(deadline: .now() + timeout, execute: item)
    conn.start(queue: q)
    read()
  }

  private func read() {
    conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
      guard let self, !self.done else { return }
      if let data { self.buffer.append(data) }
      if let end = self.buffer.range(of: Data("\r\n\r\n".utf8)) {
        let head = self.buffer.subdata(in: 0..<end.upperBound)
        guard let parsed = Head.parse(head) else { return self.respond(status: "400 Bad Request") }
        self.done = true
        self.deadline?.cancel()
        return self.server.route(self, head: parsed, raw: self.buffer)
      }
      if complete || error != nil || self.buffer.count > 16384 { return self.cancel() }
      self.read()
    }
  }

  func respond(status: String) {
    send("HTTP/1.1 \(status)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", body: Data())
  }

  func respond(file: String, type: String, cache: String, unpaired: Bool = false) {
    guard var body = FileManager.default.contents(atPath: file) else { return respond(status: "404 Not Found") }
    if unpaired {
      // Tells the page nothing can be paired yet; no phone can connect until Couch has made a key.
      let flag = Data("<script>window.COUCH_UNPAIRED=true</script>".utf8)
      if let head = body.range(of: Data("<head>".utf8)) { body.insert(contentsOf: flag, at: head.upperBound) } else { body = flag + body }
    }
    send(
      "HTTP/1.1 200 OK\r\nContent-Type: \(type)\r\nCache-Control: \(cache)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n",
      body: body)
  }

  private func send(_ head: String, body: Data) {
    done = true
    conn.send(content: Data(head.utf8) + body, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
      self?.cancel()
    })
  }

  func cancel() {
    deadline?.cancel()
    conn.cancel()
    server.finished(self)
  }
}

/// A phone on the listener's own WebSocket (Couch off or starting): only `power` does anything.
final class PhoneSocket: Session {
  private let conn: NWConnection
  private unowned let server: Server
  private unowned let power: Power
  private let q: DispatchQueue
  private let filter = FrameFilter()
  private unowned let pairing: Pairing
  private let key: String

  init(conn: NWConnection, server: Server, power: Power, pairing: Pairing, key: String, q: DispatchQueue) {
    self.conn = conn
    self.server = server
    self.power = power
    self.pairing = pairing
    self.key = key
    self.q = q
  }

  func start() {
    conn.stateUpdateHandler = { [weak self] state in
      if case .failed = state { self?.cancel() }
    }
    read()
  }

  private func read() {
    conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, complete, error in
      guard let self else { return }
      for event in self.filter.feed(data ?? Data()) {
        switch event {
        case .power:
          guard self.pairing.accepts(self.key) else { return self.cancel() }
          self.power.toggle()
        case .ping(let payload): self.send(WS.frame(opcode: 10, payload: payload))
        case .close: return self.closeSoon()
        case .violation(let code): return self.closeSoon(code: code)
        case .raw: break
        }
      }
      if complete || error != nil { return self.cancel() }
      self.read()
    }
  }

  func send(_ data: Data) { conn.send(content: data, completion: .contentProcessed { _ in }) }

  func closeSoon(code: UInt16 = 1001) {
    conn.send(content: WS.frame(opcode: 8, payload: [UInt8(code >> 8), UInt8(code & 0xff)]), contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
      self?.cancel()
    })
  }

  func cancel() {
    conn.cancel()
    server.finished(self)
  }
}

/// Pipes a phone's connection to Couch byte for byte; only `power` in WebSocket frames is taken out.
final class Proxy: Session {
  private let client: NWConnection
  private let upstream: NWConnection
  private unowned let server: Server
  private unowned let power: Power
  private let head: Data
  private let filter: FrameFilter?
  private unowned let pairing: Pairing
  private let key: String?
  private let q: DispatchQueue
  private var closed = false
  private var halfClosed = 0

  init(
    client: NWConnection, appPort: UInt16, head: Data, websocket: Bool, server: Server, power: Power, pairing: Pairing,
    key: String?, q: DispatchQueue
  ) {
    self.pairing = pairing
    self.key = key
    self.client = client
    self.upstream = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: appPort)!, using: .tcp)
    self.head = head
    self.filter = websocket ? FrameFilter() : nil
    self.server = server
    self.power = power
    self.q = q
  }

  func start() {
    upstream.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        self.upstream.send(content: self.head, completion: .contentProcessed { [weak self] e in
          guard let self else { return }
          if e != nil { return self.cancel() }
          self.pump(from: self.client, to: self.upstream, filtered: true)
          self.pump(from: self.upstream, to: self.client, filtered: false)
        })
      case .failed, .waiting: self.fail()
      default: break
      }
    }
    client.stateUpdateHandler = { [weak self] state in
      if case .failed = state { self?.cancel() }
    }
    upstream.start(queue: q)
  }

  private func fail() {
    guard !closed else { return }
    client.send(
      content: Data("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8),
      contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
        self?.cancel()
        self?.power.checkNow()
      })
  }

  private func pump(from: NWConnection, to: NWConnection, filtered: Bool) {
    from.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self, !self.closed else { return }
      var out = data ?? Data()
      if filtered, let filter = self.filter, !out.isEmpty {
        out = Data()
        for event in filter.feed(data!) {
          switch event {
          case .raw(let d): out.append(d)
          case .power:
            guard self.pairing.accepts(self.key) else { return self.cancel() }
            self.power.toggle()
          case .violation: return self.cancel()
          default: break
          }
        }
      }
      if error != nil { return self.cancel() }
      if out.isEmpty && !complete { return self.pump(from: from, to: to, filtered: filtered) }
      if complete {
        // Forward the end of this direction as a half-close; the other direction keeps going until it ends too.
        to.send(content: out.isEmpty ? nil : out, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] e in
          guard let self else { return }
          self.halfClosed += 1
          if e != nil || self.halfClosed >= 2 { self.cancel() }
        })
        return
      }
      to.send(content: out, completion: .contentProcessed { [weak self] e in
        guard let self else { return }
        if e != nil { self.cancel() } else { self.pump(from: from, to: to, filtered: filtered) }
      })
    }
  }

  func cancel() {
    guard !closed else { return }
    closed = true
    client.cancel()
    upstream.cancel()
    server.finished(self)
  }
}
