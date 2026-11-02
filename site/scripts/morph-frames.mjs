// Frames and a video of the hero intro (ticket 139), from the local preview:
//   node scripts/morph-frames.mjs <outDir> [url]
// Writes morph-1440-*.png and morph-390-*.png (steps of intro time), morph-hero-{1440,390}.png (the settled hero),
// morph-reduced-motion-1440.png, and morph.webm / morph.mp4 (30 fps at 1440; needs ffmpeg).
// It slows the page's animation clock with DevTools' playback rate (the CSS timeline and the intro's morph both
// follow document.timeline), then captures at fixed steps of intro time.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const out = process.argv[2];
const url = process.argv[3] ?? "http://localhost:4173/";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RATE = 0.05;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });
const videoDir = mkdtempSync(join(tmpdir(), "couch-morph-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });

async function run(w, h, steps, name, video) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  const cdp = await page.createCDPSession();
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: RATE });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.classList.contains("intro") && document.querySelector("svg.wm-intro").getAnimations().length > 0);
  const t = () => page.evaluate(() => {
    const a = document.querySelector("svg.wm-intro").getAnimations().find((x) => x.animationName === "intro-out");
    return a ? document.timeline.currentTime - a.startTime : 1e9;
  });
  let i = 0;
  for (const at of steps) {
    while ((await t()) < at) await wait(5);
    const file = video ? `${videoDir}/${name}-${String(i).padStart(3, "0")}.png` : `${out}/${name}-${String(i + 1).padStart(2, "0")}-${at}ms.png`;
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: Math.min(h, w > 600 ? 720 : 760) } });
    i++;
  }
  await page.close();
}

await run(1440, 900, [0, 150, 400, 700, 850, 1000, 1150, 1300, 1450, 1600, 1800, 2000, 2400], "morph-1440", false);
await run(390, 844, [0, 400, 850, 1000, 1150, 1300, 1450, 1800, 2400], "morph-390", false);
// the settled hero, and the reduced-motion hero (no intro at all)
for (const [w, h, reduce] of [[1440, 900, false], [390, 844, false], [1440, 900, true]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  if (reduce) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(url, { waitUntil: "networkidle0" });
  await wait(reduce ? 300 : 2600);
  await page.screenshot({ path: reduce ? `${out}/morph-reduced-motion-${w}.png` : `${out}/morph-hero-${w}.png` });
  await page.close();
}
if (process.env.STILLS_ONLY) { await browser.close(); process.exit(0); }
// video: 30 fps of intro time, 0 to 2.6s, at 1440
const steps = Array.from({ length: 79 }, (_, k) => Math.round((k * 1000) / 30));
await run(1440, 900, steps, "f", true);
await browser.close();
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "30", "-i", `${videoDir}/f-%03d.png`, "-vf", "scale=1440:-2", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", `${out}/morph.webm`]);
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "30", "-i", `${videoDir}/f-%03d.png`, "-vf", "scale=1440:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", `${out}/morph.mp4`]);
rmSync(videoDir, { recursive: true, force: true });
console.log("frames and video in", out);
