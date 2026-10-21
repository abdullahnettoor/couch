import Foundation

/// The pairing key in `pairing.json`, re-read whenever the file changes (checked by stat, no polling).
final class Pairing {
  private let path: String
  private var key: String?
  private var signature = ""

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
    return old != key
  }

  func accepts(_ given: String?) -> Bool {
    refresh()
    guard let given, !given.isEmpty, let key else { return false }
    return given == key
  }
}
