import Foundation

/// The pairing key in `pairing.json`, re-read whenever the file changes (checked by stat, no polling).
final class Pairing {
  private let path: String
  private var key: String?
  private var signature = ""

  /// Called whenever the key changes, from whichever path noticed it first.
  var onChange: (() -> Void)?

  init(support: String) { path = support + "/pairing.json" }

  /// True if the key changed since the last call.
  @discardableResult
  func refresh() -> Bool {
    var st = stat()
    let sig = stat(path, &st) == 0 ? "\(st.st_mtimespec.tv_sec).\(st.st_mtimespec.tv_nsec).\(st.st_size).\(st.st_ino)" : ""
    guard sig != signature else { return false }
    signature = sig
    let old = key
    key = nil
    if !sig.isEmpty, let data = FileManager.default.contents(atPath: path),
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let k = obj["key"] as? String, !k.isEmpty
    {
      key = k
    }
    let changed = old != key
    if changed { onChange?() }
    return changed
  }

  var isPaired: Bool {
    refresh()
    return key != nil
  }

  func accepts(_ given: String?) -> Bool {
    refresh()
    guard let given, !given.isEmpty, let key else { return false }
    return constantTimeEqual(given, key)
  }
}

/// Compares without stopping at the first difference.
func constantTimeEqual(_ a: String, _ b: String) -> Bool {
  let x = Array(a.utf8)
  let y = Array(b.utf8)
  var diff = x.count ^ y.count
  for i in 0..<max(x.count, y.count) {
    diff |= Int(i < x.count ? x[i] : 0) ^ Int(i < y.count ? y[i] : 0)
  }
  return diff == 0
}
