// Proves the packaged add-on loads the libmpv inside Couch.app and that it works, with Homebrew's folders unreadable
// (sandbox-exec): it creates and initialises mpv (vo=null, ao=null, no config, no window) and plays a small local
// clip with an embedded subtitle track to its end. Run after `vp run package` (needs ffmpeg, only to make the clip,
// outside the sandbox). Headless: no window, no Couch data folder, no ports.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const app = resolve("out", `Couch-darwin-${process.arch}`, "Couch.app");
const bundled = join(app, "Contents", "Frameworks", "mpv", "libmpv.2.dylib");
const addon = join(app, "Contents/Resources/app.asar.unpacked/native/mpv-embed/mpv_embed.node");
const dir = mkdtempSync(join(tmpdir(), "couch-mpv-check-"));
const profile = join(dir, "no-homebrew.sb");
writeFileSync(
  profile,
  '(version 1)\n(allow default)\n(deny file-read* (subpath "/opt/homebrew") (subpath "/usr/local"))\n',
);

// A 3 s clip: video, a sine tone and an ASS subtitle track showing "Couch subtitle check" from 0.5 s to 2.5 s.
const ass = join(dir, "sub.ass");
writeFileSync(
  ass,
  `[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.50,0:00:02.50,Default,,0,0,0,,Couch subtitle check
`,
);
const clip = join(dir, "clip.mkv");
execFileSync(
  "ffmpeg",
  ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15:duration=3"]
    .concat(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-i", ass])
    .concat(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-c:s", "ass", clip]),
  { stdio: ["ignore", "inherit", "inherit"] },
);

const script = join(dir, "load.js");
// The add-on's own Homebrew fallbacks are unreadable here, so only the bundled copy can load.
writeFileSync(
  script,
  `const addon = require(${JSON.stringify(addon)});
console.log(addon.loadLibmpv(${JSON.stringify([bundled])}));
console.log(
  addon.probePlayback(
    ${JSON.stringify([bundled])},
    ${JSON.stringify(clip)},
    { vo: "null", ao: "null", config: "no", "load-scripts": "no", ytdl: "no", sid: "1", aid: "1", vid: "1" },
    20000,
  ),
);`,
);
const run = spawnSync("sandbox-exec", ["-f", profile, join(app, "Contents/MacOS/Couch"), script], {
  encoding: "utf8",
  env: { PATH: process.env.PATH, ELECTRON_RUN_AS_NODE: "1" },
});
const [loaded, report] = run.stdout.trim().split("\n");
if (run.status !== 0 || loaded !== bundled) {
  console.error(`bundled libmpv check failed: ${loaded || run.stderr}`);
  process.exit(1);
}
console.log(`ok: loaded ${loaded} with Homebrew unreadable`);

const play = JSON.parse(report);
const problems = [];
const track = (type) => play.tracks.find((t) => t.type === type);
if (play.commandError) problems.push(`loadfile failed: ${play.commandError}`);
if (!play.loaded) problems.push("the clip never loaded");
if (!play.videoCodec) problems.push("no video decoder");
if (!play.audioCodec) problems.push("no audio decoder");
if (!track("sub")?.selected)
  problems.push(`subtitle track not selected: ${JSON.stringify(play.tracks)}`);
if (!play.subtitleLines.some((l) => l.includes("Couch subtitle check")))
  problems.push(`subtitle text never decoded: ${JSON.stringify(play.subtitleLines)}`);
if (!play.ended || play.endReason !== 0 || play.endError)
  problems.push(
    `didn't play to the end (reason ${play.endReason}, ended ${play.ended}): ${play.endError}`,
  );
if (problems.length) {
  console.error(`bundled libmpv playback check failed:\n- ${problems.join("\n- ")}\n${run.stderr}`);
  process.exit(1);
}
console.log(
  `ok: played ${basename(clip)} to the end (video ${play.videoCodec}, audio ${play.audioCodec}, subtitle track "${play.subtitleLines[0]}" decoded; vo=null so subtitle rendering itself isn't exercised)`,
);
