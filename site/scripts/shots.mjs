// Writes the product screenshots in src/shots/ from the ticket 140 shoot of the real Couch (window captures,
// 3600 × 2260 on a 16:10 display) as WebP at 1920, 1280 and 640 px wide (the slot's srcset, src/slots.ts).
// A crop never cuts through Couch's UI: Home and the Library keep the display's own 16:10 (whole frame), Settings
// and Remotes lose only empty black above and below, and the film frame loses only the player's letterbox. The
// slot's width and height in src/slots.ts match each output, and a frame holding a picture takes its aspect.
//   node scripts/shots.mjs [shootDir]   (default ~/Projects/couch-notes/shots/140; needs cwebp)
// The pictures show Blender's open films (Big Buck Bunny, Sintel, Tears of Steel: © Blender Foundation, CC BY 3.0)
// with posters and backdrops from TMDB; the page credits both. Every source was privacy-checked in ticket 140.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] ?? join(homedir(), "Projects/couch-notes/shots/140");
const out = fileURLToPath(new URL("../src/shots/", import.meta.url));
const SRC_W = 3600, SRC_H = 2260;
const H16x9 = Math.round((SRC_W * 9) / 16), H16x10 = Math.round((SRC_W * 10) / 16); // 16:10 trims 5 px of edge
/** Output name → source file and crop height and top (px in the source; full width; default centred). */
const SHOTS = {
  home: { src: "hero-home-continue-focus.png", h: H16x10 }, // 16:10: the clock and "7 min left" under the Continue card both stay whole
  library: { src: "library-first-page.png", h: H16x10 }, // 16:10: "‹ Home" and "7 min left" stay whole
  settings: { src: "settings.png", h: H16x9 }, // only empty black is cut
  remotes: { src: "remotes-devices.png", h: H16x9 }, // only empty black is cut
  player: { src: "player-clean-frame.png", h: H16x9, top: 117 }, // the film exactly, without the player's letterbox
};

for (const [name, { src, h, top }] of Object.entries(SHOTS)) {
  const y = top ?? Math.round((SRC_H - h) / 2);
  for (const [w, suffix] of [[1920, ""], [1280, "-1280"], [640, "-640"]]) {
    const file = join(out, `${name}${suffix}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", w > 1000 ? "74" : "80", "-m", "6", "-sharp_yuv", "-crop", "0", String(y), String(SRC_W), String(h), "-resize", String(w), "0", join(dir, src), "-o", file]);
    console.log(`${name}${suffix}.webp`, `${w}×${Math.round((w * h) / SRC_W)}`, Math.round(statSync(file).size / 1024), "KB");
  }
}
