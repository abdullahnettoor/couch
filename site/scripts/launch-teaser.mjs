// Saves the launch video's muted teaser into the site (public/launch/), so the first-look TV can loop it without
// asking YouTube for anything: the site serves it itself, and YouTube is contacted only when the visitor presses
// "Watch with sound" (or follows a YouTube link).
//   node scripts/launch-teaser.mjs [--start s] [--end s] [--refresh]   (pnpm launch:teaser)
// Placeholder mode (LAUNCH_VIDEO.id empty in src/config.ts): does nothing. With an id: downloads the video (video
// only, at most 1080p) with yt-dlp into a temporary folder, cuts --start → --end (the whole video by default), and
// encodes with ffmpeg: public/launch/<id>.mp4 (H.264, yuv420p, 1920 wide, no audio track, +faststart; the CRF goes up
// until it is at most 8 MB) and public/launch/<id>.webm (VP9), kept only when it is at least a quarter smaller than
// the MP4. A teaser already saved for that id is kept unless --refresh (so builds never need YouTube or ffmpeg).
// Unlike the thumbnail, pnpm build does not run it: the build only checks that the file is there.
// saveTeaser() is the whole job, with the command runner passed in (scripts/launch-thumb.test.mjs mocks it).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TARGET = 8 * 1024 * 1024; // the size the MP4 aims for
export const LIMIT = 25 * 1024 * 1024; // Cloudflare's static assets refuse bigger files
export const CRFS = [23, 26, 29, 32, 35];

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });

/** Seconds from "12", "12.5" or "1:05"; undefined for nothing. */
export function seconds(s) {
  if (s == null || s === "") return undefined;
  const n = String(s).split(":").reduce((t, p) => t * 60 + Number(p), 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`launch teaser: "${s}" is not a time in seconds`);
  return n;
}

/**
 * Saves the teaser for `id` into `dir` as <id>.mp4 (and <id>.webm when it is worth it). Returns what it did:
 * "placeholder" (no id), "cached" (the MP4 is there and no refresh) or "saved" (with `files` and their `sizes`).
 */
export async function saveTeaser({ id, dir, start, end, refresh = false, exec = run, size = (f) => statSync(f).size, log = console.log }) {
  if (!id) { log("launch teaser: placeholder mode (no id in src/config.ts), nothing to make"); return { status: "placeholder" }; }
  if (!/^[\w-]{11}$/.test(id)) throw new Error(`launch teaser: "${id}" is not a YouTube video id (11 letters, digits, - or _)`);
  const mp4 = join(dir, `${id}.mp4`), webm = join(dir, `${id}.webm`);
  if (!refresh && existsSync(mp4)) { log(`launch teaser: ${id}.mp4 already saved`); return { status: "cached" }; }
  if (start != null && end != null && end <= start) throw new Error("launch teaser: --end must come after --start");

  mkdirSync(dir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "couch-teaser-"));
  try {
    exec("yt-dlp", ["-q", "--no-playlist", "-f", "bv*[height<=1080][vcodec^=avc1]/bv*[height<=1080]", "-o", join(tmp, "src.%(ext)s"), `https://www.youtube.com/watch?v=${id}`]);
    const got = readdirSync(tmp).find((f) => f.startsWith("src."));
    if (!got) throw new Error(`launch teaser: yt-dlp saved nothing for ${id}`);
    const cut = [...(start != null ? ["-ss", String(start)] : []), ...(end != null ? ["-to", String(end)] : []), "-i", join(tmp, got)];
    const common = ["-v", "error", "-y", ...cut, "-an", "-sn", "-dn", "-map_metadata", "-1", "-vf", "scale='min(1920,iw)':-2,format=yuv420p"];

    const outMp4 = join(tmp, "out.mp4");
    let crf;
    for (crf of CRFS) {
      exec("ffmpeg", [...common, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-tag:v", "avc1", "-movflags", "+faststart", outMp4]);
      if (size(outMp4) <= TARGET) break;
    }
    if (size(outMp4) > LIMIT) throw new Error(`launch teaser: the MP4 is over 25 MiB even at CRF ${crf}; cut it shorter with --start and --end`);
    const outWebm = join(tmp, "out.webm");
    exec("ffmpeg", [...common, "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", outWebm]);

    const sizes = { mp4: size(outMp4), webm: size(outWebm) };
    renameSync(outMp4, mp4);
    const files = [mp4];
    if (sizes.webm <= sizes.mp4 * 0.75) { renameSync(outWebm, webm); files.push(webm); } else rmSync(webm, { force: true });
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    log(`launch teaser: ${id}.mp4 (CRF ${crf}), ${kb(sizes.mp4)}; VP9 ${kb(sizes.webm)}, ${files.length > 1 ? "kept" : "not kept (less than a quarter smaller)"}`);
    return { status: "saved", files, sizes, crf };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { LAUNCH_VIDEO } = await import("../src/config.ts");
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    await saveTeaser({
      id: process.env.COUCH_LAUNCH_ID ?? LAUNCH_VIDEO.id,
      dir: fileURLToPath(new URL("../public/launch/", import.meta.url)),
      start: seconds(arg("--start")),
      end: seconds(arg("--end")),
      refresh: process.argv.includes("--refresh"),
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
