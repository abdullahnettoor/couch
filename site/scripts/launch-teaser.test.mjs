// Unit tests of scripts/launch-teaser.mjs (ticket 145): the command runner and the file sizes are mocks, so nothing
// goes to YouTube and neither yt-dlp nor ffmpeg is needed. Placeholder mode and a saved teaser run nothing; a bad id
// or an end before the start is refused; the cut and the encoding settings are passed to ffmpeg; the CRF rises until
// the MP4 is at most 8 MB, and a MP4 over 25 MiB fails; the WebM is kept only when it is a quarter smaller.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { CRFS, saveTeaser, seconds } from "./launch-teaser.mjs";

const ID = "TESTvideo01";
const MB = 1024 * 1024;
const quiet = () => {};
/** A runner that "downloads" and "encodes" by writing files; `sizes(file, crf)` decides each output's size. */
function mockExec(sizes) {
  const runs = [];
  const bytes = new Map();
  const exec = (cmd, args) => {
    runs.push({ cmd, args });
    const out = args.at(-1);
    if (cmd === "yt-dlp") { writeFileSync(args[args.indexOf("-o") + 1].replace("%(ext)s", "mp4"), ""); return; }
    writeFileSync(out, "");
    const crf = args.includes("-crf") ? Number(args[args.indexOf("-crf") + 1]) : undefined;
    bytes.set(basename(out), sizes(basename(out), crf));
  };
  const size = (f) => bytes.get(basename(f).replace(/^TESTvideo01/, "out")) ?? bytes.get(basename(f));
  return { exec, runs, size };
}

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "couch-teaser-test-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("seconds reads 12, 12.5 and 1:05", () => {
  assert.equal(seconds("12"), 12);
  assert.equal(seconds("12.5"), 12.5);
  assert.equal(seconds("1:05"), 65);
  assert.equal(seconds(undefined), undefined);
  assert.throws(() => seconds("soon"));
});

test("placeholder mode and a saved teaser run nothing", async () => {
  const m = mockExec(() => MB);
  assert.equal((await saveTeaser({ id: "", dir, exec: m.exec, log: quiet })).status, "placeholder");
  writeFileSync(join(dir, `${ID}.mp4`), "");
  assert.equal((await saveTeaser({ id: ID, dir, exec: m.exec, log: quiet })).status, "cached");
  assert.equal(m.runs.length, 0);
});

test("a bad id or an end before the start is refused", async () => {
  await assert.rejects(saveTeaser({ id: "nope", dir, exec: () => {}, log: quiet }), /not a YouTube video id/);
  await assert.rejects(saveTeaser({ id: ID, dir, start: 20, end: 10, exec: () => {}, log: quiet }), /--end must come after --start/);
});

test("downloads the video only, cuts it, encodes a muted faststart H.264 MP4 at 1920 wide; a small WebM is kept", async () => {
  const m = mockExec((f) => (f.endsWith(".webm") ? 2 * MB : 4 * MB));
  const r = await saveTeaser({ id: ID, dir, start: 5, end: 35, exec: m.exec, size: m.size, log: quiet });
  assert.equal(r.status, "saved");
  assert.equal(r.crf, CRFS[0]);
  const [dl, mp4, webm] = m.runs;
  assert.equal(dl.cmd, "yt-dlp");
  assert.ok(dl.args.includes(`https://www.youtube.com/watch?v=${ID}`));
  assert.match(dl.args[dl.args.indexOf("-f") + 1], /^bv\*/, "video only");
  for (const a of ["-an", "-movflags", "+faststart", "libx264"]) assert.ok(mp4.args.includes(a), a);
  assert.deepEqual(mp4.args.slice(mp4.args.indexOf("-ss"), mp4.args.indexOf("-ss") + 4), ["-ss", "5", "-to", "35"]);
  assert.match(mp4.args[mp4.args.indexOf("-vf") + 1], /1920.*yuv420p/);
  assert.ok(webm.args.includes("libvpx-vp9") && webm.args.includes("-an"));
  assert.ok(existsSync(join(dir, `${ID}.mp4`)) && existsSync(join(dir, `${ID}.webm`)));
});

test("the CRF rises until the MP4 is at most 8 MB; a WebM that is not a quarter smaller is dropped", async () => {
  const m = mockExec((f, crf) => (f.endsWith(".webm") ? 3 * MB : crf < 29 ? 9 * MB : 3.5 * MB));
  const r = await saveTeaser({ id: ID, dir, exec: m.exec, size: m.size, log: quiet });
  assert.equal(r.crf, 29);
  assert.deepEqual(m.runs.filter((x) => x.args.includes("libx264")).map((x) => Number(x.args[x.args.indexOf("-crf") + 1])), [23, 26, 29]);
  assert.ok(!m.runs[1].args.includes("-ss"), "the whole video without --start");
  assert.ok(existsSync(join(dir, `${ID}.mp4`)));
  assert.ok(!existsSync(join(dir, `${ID}.webm`)));
});

test("an MP4 over 25 MiB at the highest CRF fails", async () => {
  const m = mockExec(() => 30 * MB);
  await assert.rejects(saveTeaser({ id: ID, dir, exec: m.exec, size: m.size, log: quiet }), /over 25 MiB/);
  assert.ok(!existsSync(join(dir, `${ID}.mp4`)));
});
