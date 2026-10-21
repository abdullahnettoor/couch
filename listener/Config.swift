import Foundation

struct Config {
  var publicPort: UInt16 = 4747
  var appPort: UInt16 = 4748
  var support = NSHomeDirectory() + "/Library/Application Support/Couch"
  var page = ""
  var icons = ""
  var launch = "open -a /Applications/Couch.app"
  var startTimeout = 30.0
  var headerTimeout = 10.0

  static func parse() -> Config {
    var c = Config()
    let env = ProcessInfo.processInfo.environment
    if let p = env["COUCH_PORT"].flatMap({ UInt16($0) }) { c.publicPort = p }
    if let p = env["COUCH_APP_PORT"].flatMap({ UInt16($0) }) { c.appPort = p }

    let exeDir = (CommandLine.arguments[0] as NSString).deletingLastPathComponent
    let beside = exeDir + "/remote"
    let fm = FileManager.default
    c.page = fm.fileExists(atPath: beside + "/page.html") ? beside + "/page.html" : "dist/remote/page.html"
    c.icons = fm.fileExists(atPath: beside) ? beside : "dist/renderer"

    var args = CommandLine.arguments.dropFirst()
    while let flag = args.popFirst() {
      guard let value = args.popFirst() else { break }
      switch flag {
      case "--support": c.support = value
      case "--page": c.page = value
      case "--icons": c.icons = value
      case "--launch": c.launch = value
      case "--start-timeout": c.startTimeout = Double(value) ?? c.startTimeout
      case "--header-timeout": c.headerTimeout = Double(value) ?? c.headerTimeout
      default: break
      }
    }
    return c
  }
}

func log(_ message: String) {
  FileHandle.standardError.write(Data("couch-listener: \(message)\n".utf8))
}
