// pnpm skips castLabs' Electron download script (it is a git dependency), so run it when the binary is missing.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (
  existsSync("node_modules/electron/install.js") &&
  !existsSync("node_modules/electron/path.txt")
) {
  execFileSync(process.execPath, ["node_modules/electron/install.js"], { stdio: "inherit" });
}
