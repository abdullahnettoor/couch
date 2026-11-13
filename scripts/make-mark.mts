// Makes the Couch mark, the sofa and its lit Screen without the dark square, from build/icon.png and the outline in
// build/couch-mark.svg (macOS sips and ffmpeg). Run by `vp run icons` (scripts/make-icons.sh).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodePng, encodePng } from "./look-diff.ts";
import { cropToMark } from "./lib/couch-mark.mts";

/** Each file and its size in px: the Remote's tab icons and its off screen (served from the renderer), and the README's header. */
const OUT: Record<string, number> = {
  "src/renderer/public/mark-32.png": 32,
  "src/renderer/public/mark-256.png": 256,
  "docs/brand/couch-mark-128.png": 128,
};
/** Clear space around the sofa, in the icon's px. */
const MARGIN = 10;

process.chdir(resolve(import.meta.dirname, ".."));
const tmp = mkdtempSync(join(tmpdir(), "couch-mark-"));
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
const ffmpeg = (args: string[]) =>
  run("ffmpeg", ["-v", "error", "-y", ...args, "-pix_fmt", "rgba"]);
try {
  run("sips", ["-s", "format", "png", "build/couch-mark.svg", "--out", `${tmp}/outline.png`]);
  // The outline becomes the icon's alpha, pulled in 1 px so none of the square's navy rims the sofa, and feathered.
  ffmpeg([
    "-i",
    "build/icon.png",
    "-i",
    `${tmp}/outline.png`,
    "-filter_complex",
    "[1]format=gray,erosion,gblur=sigma=0.8[a];[0]format=rgba[i];[i][a]alphamerge",
    `${tmp}/cut.png`,
  ]);
  writeFileSync(
    `${tmp}/mark.png`,
    encodePng(cropToMark(decodePng(readFileSync(`${tmp}/cut.png`)), MARGIN)),
  );
  for (const [file, size] of Object.entries(OUT)) {
    // Lanczos, and a light sharpen at tab-icon sizes so the Screen's frame stays crisp.
    const sharpen = size <= 48 ? ",unsharp=3:3:0.6" : "";
    ffmpeg(["-i", `${tmp}/mark.png`, "-vf", `scale=${size}:${size}:flags=lanczos${sharpen}`, file]);
  }
  console.log(`Couch mark written to ${Object.keys(OUT).join(", ")}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
