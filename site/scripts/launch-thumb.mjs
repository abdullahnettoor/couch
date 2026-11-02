// Saves the launch video's thumbnail into the build (ticket 145), so the page never asks YouTube for it: the
// visitor's browser talks to YouTube only after pressing play.
//   node scripts/launch-thumb.mjs [--refresh]   (pnpm build runs it; pnpm launch:thumb on its own)
// Placeholder mode (LAUNCH_VIDEO.id empty in src/config.ts): does nothing and fetches nothing.
// With an id: fetches https://i.ytimg.com/vi/<id>/maxresdefault.jpg (or sddefault / hqdefault when a video has no
// 1280 × 720 thumbnail; their 4:3 letterbox is cropped back to 16:9) and writes src/shots/launch/<id>.webp (1280 wide)
// and <id>-640.webp with cwebp. A thumbnail already saved for that id (both files) is kept unless --refresh (so builds
// work offline once it is saved). COUCH_LAUNCH_ID overrides the id; with COUCH_LAUNCH_THUMB (a local picture, the
// tests) nothing is fetched. saveThumb() is the whole job, with fetch and the converter passed in
// (scripts/launch-thumb.test.mjs mocks both).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCES = ["maxresdefault", "sddefault", "hqdefault"];

/** Width and height of a JPEG, from its first start-of-frame marker. */
export function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("not a JPEG");
}

/** cwebp: the JPEG at `src`, cropped to `crop` ([x, y, w, h]) and `width` wide, to `out`. */
export function cwebp(src, out, { width, crop, quality }) {
  execFileSync("cwebp", ["-quiet", "-q", String(quality), "-m", "6", "-sharp_yuv", "-crop", ...crop.map(String), "-resize", String(width), "0", src, "-o", out]);
}

/**
 * Saves the thumbnail for `id` into `dir` as <id>.webp and <id>-640.webp. Returns what it did: "placeholder" (no id),
 * "local" (a local picture is used), "cached" (both files are there and no refresh) or "saved" (with `from`, the
 * source's name). Throws on a bad id or when YouTube has no thumbnail.
 */
export async function saveThumb({ id, local, dir, refresh = false, fetch = globalThis.fetch, convert = cwebp, log = console.log }) {
  if (!id) { log("launch video: placeholder mode (no id in src/config.ts), nothing to fetch"); return { status: "placeholder" }; }
  if (local) { log(`launch video: using ${local}, nothing to fetch`); return { status: "local" }; }
  if (!/^[\w-]{11}$/.test(id)) throw new Error(`launch video: "${id}" is not a YouTube video id (11 letters, digits, - or _)`);
  const files = [[1280, join(dir, `${id}.webp`)], [640, join(dir, `${id}-640.webp`)]];
  if (!refresh && files.every(([, f]) => existsSync(f))) { log(`launch video: ${id}.webp already saved`); return { status: "cached" }; }

  let got;
  for (const name of SOURCES) {
    const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const size = jpegSize(buf);
    if (size.w < 400) continue; // YouTube's grey 120 × 90 "no thumbnail" stand-in
    got = { name, buf, ...size };
    break;
  }
  if (!got) throw new Error(`launch video: YouTube has no thumbnail for ${id} (is the video public?)`);

  mkdirSync(dir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "couch-thumb-"));
  try {
    const jpg = join(tmp, "thumb.jpg");
    writeFileSync(jpg, got.buf);
    // 16:9: maxres already is; the 4:3 ones carry the 16:9 picture between black bars
    const h = Math.round((got.w * 9) / 16);
    const crop = [0, Math.round((got.h - h) / 2), got.w, h];
    for (const [w, file] of files) {
      convert(jpg, file, { width: Math.min(w, got.w), crop, quality: w > 1000 ? 74 : 80 });
      log(`launch video: ${file.slice(dir.length)} from ${got.name}.jpg (${got.w} × ${got.h}),`, Math.round(statSync(file).size / 1024), "KB");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { status: "saved", from: got.name };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { LAUNCH_VIDEO } = await import("../src/config.ts");
  try {
    await saveThumb({
      id: process.env.COUCH_LAUNCH_ID ?? LAUNCH_VIDEO.id,
      local: process.env.COUCH_LAUNCH_THUMB,
      dir: fileURLToPath(new URL("../src/shots/launch/", import.meta.url)),
      refresh: process.argv.includes("--refresh"),
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
