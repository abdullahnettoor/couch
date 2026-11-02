// Proves the packaged add-on loads the libmpv inside Couch.app, with Homebrew's folders unreadable (sandbox-exec).
// Run after `vp run package`. Headless: no window, no Couch data folder, no ports.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = resolve("out", `Couch-darwin-${process.arch}`, "Couch.app");
const bundled = join(app, "Contents", "Frameworks", "mpv", "libmpv.2.dylib");
const addon = join(app, "Contents/Resources/app.asar.unpacked/native/mpv-embed/mpv_embed.node");
const dir = mkdtempSync(join(tmpdir(), "couch-mpv-check-"));
const profile = join(dir, "no-homebrew.sb");
writeFileSync(
  profile,
  '(version 1)\n(allow default)\n(deny file-read* (subpath "/opt/homebrew") (subpath "/usr/local"))\n',
);
const script = join(dir, "load.js");
// The add-on's own Homebrew fallbacks are unreadable here, so only the bundled copy can load.
writeFileSync(
  script,
  `console.log(require(${JSON.stringify(addon)}).loadLibmpv(${JSON.stringify([bundled])}));`,
);
const run = spawnSync("sandbox-exec", ["-f", profile, join(app, "Contents/MacOS/Couch"), script], {
  encoding: "utf8",
  env: { PATH: process.env.PATH, ELECTRON_RUN_AS_NODE: "1" },
});
const loaded = run.stdout.trim();
if (run.status !== 0 || loaded !== bundled) {
  console.error(`bundled libmpv check failed: ${loaded || run.stderr}`);
  process.exit(1);
}
console.log(`ok: loaded ${loaded} with Homebrew unreadable`);
