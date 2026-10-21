// Runs Electron as "Couch": a cached copy of Electron.app with a patched Info.plist and Couch's
// icon, so the menu bar, Dock and Cmd-Tab show Couch during development.
import { spawn, execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const electronBin = require("electron");
const srcApp = join(dirname(electronBin), "../..");
const version = JSON.parse(
  readFileSync(join(dirname(require.resolve("electron/package.json")), "package.json"), "utf8"),
).version;
const cache = join("node_modules", ".cache", "couch-dev");
const app = join(cache, "Couch.app");
const stamp = join(cache, "version");
const icon = join("build", "icon.icns");
// Rebuild the copy when Electron or the icon changes.
const wanted = `${version} ${existsSync(icon) ? statSync(icon).mtimeMs : 0}`;

if (!existsSync(app) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== wanted) {
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  cpSync(srcApp, app, { recursive: true, verbatimSymlinks: true });
  renameSync(join(app, "Contents/MacOS/Electron"), join(app, "Contents/MacOS/Couch"));
  const plist = join(app, "Contents/Info.plist");
  const set = (k, v) => execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${k} ${v}`, plist]);
  set("CFBundleExecutable", "Couch");
  set("CFBundleName", "Couch");
  set("CFBundleDisplayName", "Couch");
  if (existsSync(icon)) copyFileSync(icon, join(app, "Contents/Resources/electron.icns"));
  // A fresh bundle path makes the Dock read the new icon instead of a cached one.
  execFileSync("touch", [app]);
  writeFileSync(stamp, wanted);
}

const child = spawn(
  join(app, "Contents/MacOS/Couch"),
  [".", ...process.argv.slice(2).filter((a) => a !== "--")],
  {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
