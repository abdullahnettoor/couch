import CryptoKit
import Foundation

enum WS {
  static func accept(for clientKey: String) -> String {
    let digest = Insecure.SHA1.hash(data: Data((clientKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))
    return Data(digest).base64EncodedString()
  }

  /// An unmasked server frame.
  static func frame(opcode: UInt8, payload: [UInt8]) -> Data {
    var out: [UInt8] = [0x80 | opcode]
    if payload.count < 126 {
      out.append(UInt8(payload.count))
    } else {
      out.append(126)
      out.append(UInt8(payload.count >> 8))
      out.append(UInt8(payload.count & 0xff))
    }
    return Data(out + payload)
  }

  static func text(_ s: String) -> Data { frame(opcode: 1, payload: Array(s.utf8)) }

  static func isPowerCommand(_ payload: [UInt8]) -> Bool {
    guard let obj = try? JSONSerialization.jsonObject(with: Data(payload)) as? [String: Any] else { return false }
    return obj["type"] as? String == "command" && obj["command"] as? String == "power"
  }
}

/// Walks client frames. Every frame is read whole (up to `maxMessage`) so `power` can be picked out,
/// including when a text message arrives in fragments; everything else is passed along untouched.
final class FrameFilter {
  enum Event {
    case raw(Data)
    case power
    case ping([UInt8])
    case close
    /// A protocol error (1002) or an oversize frame (1009): the connection should be closed with this code.
    case violation(UInt16)
  }

  /// The listener's own endpoints only ever see `power`, so they keep a small limit.
  static let ownMaxMessage = 1 << 20
  /// Proxied Remote connections carry photos: Couch's MAX_PHOTO_DATA (4 MiB of base64) plus its envelope.
  static let proxiedMaxMessage = 4 * 1024 * 1024 + 4096

  let maxMessage: Int

  init(maxMessage: Int = FrameFilter.ownMaxMessage) { self.maxMessage = maxMessage }

  private var buf: [UInt8] = []
  private var failed = false
  /// An unfinished text message: its payload so far and the raw frames to forward if it isn't `power`.
  private var fragment: (payload: [UInt8], raw: Data)?
  private var inBinaryMessage = false

  func feed(_ data: Data) -> [Event] {
    guard !failed else { return [] }
    buf.append(contentsOf: data)
    var events: [Event] = []
    while let event = next() {
      events.append(contentsOf: event)
      if failed { break }
    }
    return events
  }

  private func fail(_ code: UInt16) -> [Event] {
    failed = true
    buf = []
    fragment = nil
    return [.violation(code)]
  }

  /// One frame's events, or nil when more bytes are needed.
  private func next() -> [Event]? {
    guard buf.count >= 2 else { return nil }
    let b0 = buf[0]
    let b1 = buf[1]
    let fin = b0 & 0x80 != 0
    let opcode = b0 & 0x0f
    let masked = b1 & 0x80 != 0
    let len7 = Int(b1 & 0x7f)
    if b0 & 0x70 != 0 || !masked { return fail(1002) }
    let control = opcode >= 8
    if (opcode > 2 && opcode < 8) || opcode > 10 { return fail(1002) }
    if control && (!fin || len7 > 125) { return fail(1002) }

    var headerLen = 2
    var length = len7
    if len7 == 126 {
      headerLen += 2
      guard buf.count >= headerLen else { return nil }
      length = Int(buf[2]) << 8 | Int(buf[3])
    } else if len7 == 127 {
      headerLen += 8
      guard buf.count >= headerLen else { return nil }
      if buf[2] & 0x80 != 0 { return fail(1002) }
      var wide: UInt64 = 0
      for byte in buf[2..<10] { wide = wide << 8 | UInt64(byte) }
      guard wide <= UInt64(maxMessage) else { return fail(1009) }
      length = Int(wide)
    }
    guard length <= maxMessage else { return fail(1009) }
    headerLen += 4
    guard buf.count >= headerLen + length else { return nil }

    let total = headerLen + length
    let m = Array(buf[(headerLen - 4)..<headerLen])
    var payload = Array(buf[headerLen..<total])
    for i in payload.indices { payload[i] ^= m[i & 3] }
    let whole = Data(buf[0..<total])
    buf.removeFirst(total)

    switch opcode {
    case 8: return [.raw(whole), .close]
    case 9: return [.raw(whole), .ping(payload)]
    case 10: return [.raw(whole)]
    case 1, 2:
      if fragment != nil || inBinaryMessage { return fail(1002) }
      if opcode == 2 {
        inBinaryMessage = !fin
        return [.raw(whole)]
      }
      if fin { return message(payload, raw: whole) }
      fragment = (payload, whole)
      return []
    default:
      if inBinaryMessage {
        if fin { inBinaryMessage = false }
        return [.raw(whole)]
      }
      guard var f = fragment else { return fail(1002) }
      if f.payload.count + payload.count > maxMessage { return fail(1009) }
      f.payload += payload
      f.raw.append(whole)
      if fin {
        fragment = nil
        return message(f.payload, raw: f.raw)
      }
      fragment = f
      return []
    }
  }

  private func message(_ payload: [UInt8], raw: Data) -> [Event] {
    WS.isPowerCommand(payload) ? [.power] : [.raw(raw)]
  }
}
