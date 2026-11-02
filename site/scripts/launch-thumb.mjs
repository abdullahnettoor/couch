// Saves the launch video's thumbnail into the build (ticket 145), so the page never asks YouTube for it: the
// visitor's browser talks to YouTube only after pressing play.
//   node scripts/launch-thumb.mjs [--refresh]   (pnpm build runs it; pnpm launch:thumb on its own)
// Placeholder mode (LAUNCH_VIDEO.id empty in src/config.ts): does nothing and fetches nothing.
// With an id: fetches https://i.ytimg.com/vi/<id>/maxresdefault.jpg (or sddefault / hqdefault when a video has no
// 1280 × 720 thumbnail; their 4:3 letterbox is cropped back to 16:9) and writes src/shots/launch/<id>.webp (1280 wide)
// and <id>-640.webp with cwebp. A thumbnail already saved for that id is kept unless --refresh (so builds work offline
// once it is saved). COUCH_LAUNCH_ID overrides the id; with COUCH_LAUNCH_THUMB (a local picture, the tests) nothing is fetched.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCH_VIDEO } from "../src/config.ts";

const id = process.env.COUCH_LAUNCH_ID ?? LAUNCH_VIDEO.id;
if (!id) { console.log("launch video: placeholder mode (no id in src/config.ts), nothing to fetch"); process.exit(0); }
if (process.env.COUCH_LAUNCH_THUMB) { console.log(`launch video: using ${process.env.COUCH_LAUNCH_THUMB}, nothing to fetch`); process.exit(0); }
if (!/^[\w-]{11}$/.test(id)) { console.error(`launch video: "${id}" is not a YouTube video id (11 letters, digits, - or _)`); process.exit(1); }

const dir = fileURLToPath(new URL("../src/shots/launch/", import.meta.url));
const out = join(dir, `${id}.webp`);
if (existsSync(out) && !process.argv.includes("--refresh")) { console.log(`launch video: ${id}.webp already saved`); process.exit(0); }

/** Width and height of a JPEG, from its first start-of-frame marker. */
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("not a JPEG");
}

let got;
for (const name of ["maxresdefault", "sddefault", "hqdefault"]) {
  const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`);
  if (!res.ok) continue;
  const buf = Buffer.from(await res.arrayBuffer());
  const size = jpegSize(buf);
  if (size.w < 400) continue; // YouTube's grey 120 × 90 "no thumbnail" stand-in
  got = { name, buf, ...size };
  break;
}
if (!got) { console.error(`launch video: YouTube has no thumbnail for ${id} (is the video public?)`); process.exit(1); }

mkdirSync(dir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "couch-thumb-"));
const jpg = join(tmp, "thumb.jpg");
writeFileSync(jpg, got.buf);
// 16:9: maxres already is; the 4:3 ones carry the 16:9 picture between black bars
const h = Math.round((got.w * 9) / 16);
const crop = ["-crop", "0", String(Math.round((got.h - h) / 2)), String(got.w), String(h)];
for (const [w, file] of [[1280, out], [640, join(dir, `${id}-640.webp`)]]) {
  execFileSync("cwebp", ["-quiet", "-q", w > 1000 ? "74" : "80", "-m", "6", "-sharp_yuv", ...crop, "-resize", String(Math.min(w, got.w)), "0", jpg, "-o", file]);
  console.log(`launch video: ${file.slice(dir.length)} from ${got.name}.jpg (${got.w} × ${got.h}),`, Math.round(statSync(file).size / 1024), "KB");
}
rmSync(tmp, { recursive: true, force: true });
