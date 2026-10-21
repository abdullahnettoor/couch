import Foundation

var signalSources: [DispatchSourceSignal] = []
let cfg = Config.parse()
let q = DispatchQueue(label: "couch.listener")

var token = ""
do {
  var bytes = [UInt8](repeating: 0, count: 32)
  for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
  token = Data(bytes).base64EncodedString()
    .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

let statusPath = cfg.support + "/listener.json"

func writeStatus() {
  let obj: [String: Any] = ["pid": getpid(), "publicPort": Int(cfg.publicPort), "appPort": Int(cfg.appPort), "token": token]
  guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
  try? FileManager.default.createDirectory(atPath: cfg.support, withIntermediateDirectories: true)
  let tmp = statusPath + ".tmp"
  let fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
  guard fd >= 0 else { return }
  _ = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
  close(fd)
  rename(tmp, statusPath)
}

func shutdown() -> Never {
  unlink(statusPath)
  exit(0)
}

let pairing = Pairing(support: cfg.support)
let power = Power(q: q, cfg: cfg, token: token)
let server = Server(q: q, cfg: cfg, power: power, pairing: pairing)

for sig in [SIGTERM, SIGINT] {
  signal(sig, SIG_IGN)
  let src = DispatchSource.makeSignalSource(signal: sig, queue: q)
  src.setEventHandler { shutdown() }
  src.resume()
  signalSources.append(src)
}

holdAwakeAssertion()
server.start(
  ready: {
    writeStatus()
    power.start()
    log("listening on port \(cfg.publicPort)")
  },
  failed: {
    log("could not listen on port \(cfg.publicPort)")
    exit(1)
  })

let pairingTimer = DispatchSource.makeTimerSource(queue: q)
pairingTimer.schedule(deadline: .now() + 2, repeating: 2, leeway: .milliseconds(500))
pairingTimer.setEventHandler { server.tickPairing() }
pairingTimer.resume()

dispatchMain()
