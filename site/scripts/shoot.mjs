// Screenshots of the local preview (pnpm preview) at 1440, 1024, 768 and 390 px.
// Per width: full page, the hero viewport, and the Remote sequence's end state (viewport).
// Usage: node scripts/shoot.mjs <outDir> [url]
import puppeteer from "puppeteer-core";
const out = process.argv[2];
const url = process.argv[3] ?? "http://localhost:4173/";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await wait(4400); // the hero intro (tickets 139 and 143) has settled
  await page.screenshot({ path: `${out}/hero-${w}.png` });
  // Remote sequence: let it play once through, then capture the connected end state
  await page.evaluate(() => document.getElementById("how").scrollIntoView({ block: "start" }));
  await page.evaluate(() => document.querySelector("[data-seq]").scrollIntoView({ block: "center" }));
  await wait(7500);
  await page.screenshot({ path: `${out}/remote-end-${w}.png` });
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += h / 2) { await page.evaluate((y) => scrollTo(0, y), y); await wait(100); }
  await wait(900);
  await page.evaluate(() => scrollTo(0, 0));
  await wait(300);
  await page.screenshot({ path: `${out}/full-${w}.png`, fullPage: true });
  await page.close();
}
await browser.close();
