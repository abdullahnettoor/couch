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

/// Walks client frames. Small text and control frames are read whole so `power` can be picked out;
/// everything else streams through untouched.
final class FrameFilter {
  enum Event {
    case raw(Data)
    case power
    case ping([UInt8])
    case close
  }

  private var buf: [UInt8] = []
  private var passthrough = 0

  func feed(_ data: Data) -> [Event] {
    buf.append(contentsOf: data)
    var events: [Event] = []
    while !buf.isEmpty {
      if passthrough > 0 {
        let n = min(passthrough, buf.count)
        events.append(.raw(Data(buf[0..<n])))
        buf.removeFirst(n)
        passthrough -= n
        continue
      }
      guard buf.count >= 2 else { break }
      let fin = buf[0] & 0x80 != 0
      let opcode = buf[0] & 0x0f
      let masked = buf[1] & 0x80 != 0
      let len7 = Int(buf[1] & 0x7f)
      var headerLen = 2 + (masked ? 4 : 0)
      var length = len7
      if len7 == 126 {
        headerLen += 2
        guard buf.count >= headerLen else { break }
        length = Int(buf[2]) << 8 | Int(buf[3])
      } else if len7 == 127 {
        headerLen += 8
        guard buf.count >= headerLen else { break }
        length = buf[2..<10].reduce(0) { $0 << 8 | Int($1) }
      }
      guard buf.count >= headerLen else { break }

      let inspect = (opcode == 1 && fin && length <= 1024) || (opcode >= 8 && length <= 125)
      guard inspect else {
        events.append(.raw(Data(buf[0..<headerLen])))
        buf.removeFirst(headerLen)
        passthrough = length
        continue
      }
      guard buf.count >= headerLen + length else { break }
      var payload = Array(buf[headerLen..<headerLen + length])
      if masked {
        let m = Array(buf[(headerLen - 4)..<headerLen])
        for i in payload.indices { payload[i] ^= m[i % 4] }
      }
      let whole = Data(buf[0..<headerLen + length])
      buf.removeFirst(headerLen + length)
      switch opcode {
      case 1 where WS.isPowerCommand(payload): events.append(.power)
      case 8: events.append(.raw(whole)); events.append(.close)
      case 9: events.append(.raw(whole)); events.append(.ping(payload))
      default: events.append(.raw(whole))
      }
    }
    return events
  }
}
