// Full-page screenshots of the local preview (pnpm preview) at several widths.
// Usage: node scripts/shoot.mjs <outDir> [url]
import puppeteer from "puppeteer-core";
const out = process.argv[2];
const url = process.argv[3] ?? "http://localhost:4173/";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += h / 2) { await page.evaluate((y) => scrollTo(0, y), y); await new Promise((r) => setTimeout(r, 120)); }
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${out}/viewport-${w}.png` });
  await page.evaluate(() => scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `${out}/full-${w}.png`, fullPage: true });
  await page.close();
}
await browser.close();
