// Runs Electron as "Couch": a cached copy of Electron.app with a patched Info.plist, so the
// menu bar, Dock and Cmd-Tab show Couch during development.
import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  readFileSync,
  writeFileSync,
  rmSync,
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

if (!existsSync(app) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== version) {
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  cpSync(srcApp, app, { recursive: true, verbatimSymlinks: true });
  renameSync(join(app, "Contents/MacOS/Electron"), join(app, "Contents/MacOS/Couch"));
  const plist = join(app, "Contents/Info.plist");
  const set = (k, v) => execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${k} ${v}`, plist]);
  set("CFBundleExecutable", "Couch");
  set("CFBundleName", "Couch");
  set("CFBundleDisplayName", "Couch");
  writeFileSync(stamp, version);
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
