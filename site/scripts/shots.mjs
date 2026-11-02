// Writes the product screenshots in src/shots/ from the ticket 140 shoot of the real Couch (window captures,
// 3600 × 2260 on a 16:10 display): each is cropped to the Screen's 16:9 and written as WebP at 1920, 1280 and
// 640 px wide (the slot's srcset, src/slots.ts).
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
/** Output name → source file and the top of the 16:9 crop (px in the source; the rest is centred). */
const SHOTS = {
  home: { src: "hero-home-continue-focus.png", top: 60 }, // keeps the clock and "1 phone connected" clear of the edge
  library: { src: "library-first-page.png", top: 0 }, // keeps "‹ Home"
  settings: { src: "settings.png" },
  remotes: { src: "remotes-devices.png" },
  player: { src: "player-controls.png", top: 120 }, // the player's own letterbox falls outside
};
const W = 3600, H = Math.round((W * 9) / 16);

for (const [name, { src, top }] of Object.entries(SHOTS)) {
  const y = top ?? Math.round((2260 - H) / 2);
  for (const [w, suffix] of [[1920, ""], [1280, "-1280"], [640, "-640"]]) {
    const file = join(out, `${name}${suffix}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", w > 1000 ? "74" : "80", "-m", "6", "-sharp_yuv", "-crop", "0", String(y), String(W), String(H), "-resize", String(w), "0", join(dir, src), "-o", file]);
    console.log(`${name}${suffix}.webp`, Math.round(statSync(file).size / 1024), "KB");
  }
}
