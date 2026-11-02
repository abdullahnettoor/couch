// Frames and a video of the launch video's sequence in the first-look TV (ticket 145), from a local preview:
//   node scripts/launch-frames.mjs <outDir> [url]
// Writes launch-<w>-NN-<ms>ms.png (desktop 1440 × 900 and phone 390 × 844, steps of sequence time from the start),
// launch-<w>-00-before.png (the screenshot, before it starts), launch-<w>-end.png, launch-reduced-motion-<w>.png,
// and launch-<w>.webm / .mp4 (30 fps; needs ffmpeg). The page's animation clock is slowed with DevTools' playback
// rate; the sequence runs on that clock (src/launch.ts), so every frame lands where it says. Nothing is fetched
// from YouTube: requests to YouTube's hosts are refused.
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
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const YT = /(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)$/;

async function open(w, h, { dpr = 2, reduce = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  if (reduce) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setRequestInterception(true);
  page.on("request", (r) => (YT.test(new URL(r.url()).hostname) ? r.abort() : r.continue()));
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.keyboard.press("Shift"); // skips the hero intro
  await page.waitForFunction(() => document.documentElement.classList.contains("intro-done") || !document.documentElement.classList.contains("intro"));
  await wait(400);
  return page;
}
/** Scrolls the first-look TV to the middle of the window (the scroll that brings it into view starts the sequence). */
const toTv = (page) => page.evaluate(() => {
  const tv = document.querySelector("[data-launch]").closest(".tv");
  const r = tv.getBoundingClientRect();
  scrollTo({ top: scrollY + r.top + r.height / 2 - innerHeight / 2 + 30, behavior: "instant" });
});

async function run(w, h, steps, name, { dpr = 2, dir = out, numbered = true } = {}) {
  const page = await open(w, h, { dpr });
  const cdp = await page.createCDPSession();
  await cdp.send("Animation.enable");
  // before: the screenshot, just short of the 60 % in view that starts it
  if (numbered) {
    await page.evaluate(() => {
      const tv = document.querySelector("[data-launch]").closest(".tv");
      const r = tv.getBoundingClientRect();
      scrollTo({ top: scrollY + r.top - innerHeight + r.height * 0.45, behavior: "instant" });
    });
    await wait(300);
  }
  await cdp.send("Animation.setPlaybackRate", { playbackRate: RATE });
  await toTv(page);
  if (numbered) { await wait(60); await page.screenshot({ path: `${dir}/${name}-00-before.png` }); }
  await page.waitForFunction(() => document.querySelector("[data-launch]").dataset.start);
  const t = () => page.evaluate(() => document.timeline.currentTime - Number(document.querySelector("[data-launch]").dataset.start));
  let i = 0;
  for (const at of steps) {
    while ((await t()) < at) await wait(5);
    const file = numbered ? `${dir}/${name}-${String(i + 1).padStart(2, "0")}-${at}ms.png` : `${dir}/${name}-${String(i).padStart(3, "0")}.png`;
    await page.screenshot({ path: file, captureBeyondViewport: false });
    i++;
  }
  if (numbered) {
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await wait(1500);
    await page.screenshot({ path: `${dir}/${name}-end.png` });
  }
  await page.close();
}

const STEPS = [0, 200, 420, 700, 940, 1200, 1460, 1800, 2160, 2340, 2460, 2600, 2850, 3140, 3400, 3900];
await run(1440, 900, STEPS, "launch-1440");
await run(390, 844, STEPS, "launch-390");
for (const w of [1440, 390]) {
  const page = await open(w, w > 600 ? 900 : 844, { reduce: true });
  await toTv(page);
  await wait(300);
  await page.screenshot({ path: `${out}/launch-reduced-motion-${w}.png` });
  await page.close();
}
if (!process.env.STILLS_ONLY) {
  // video: 30 fps of sequence time, -0.3 to 4.2 s
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const dir = mkdtempSync(join(tmpdir(), "couch-launch-"));
    const steps = Array.from({ length: 127 }, (_, k) => Math.round((k * 1000) / 30));
    await run(w, h, steps, "f", { dpr: w > 600 ? 1 : 2, dir, numbered: false });
    for (const [ext, codec] of [["webm", ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34"]], ["mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22"]]]) {
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "30", "-i", `${dir}/f-%03d.png`, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", ...codec, `${out}/launch-${w}.${ext}`]);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
await browser.close();
console.log("frames and video in", out);
