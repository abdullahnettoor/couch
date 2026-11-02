// Regenerates public/og.png (1200x630) from scripts/og.html.
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await puppeteer.launch({ executablePath: chrome, headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 630 });
await p.goto(new URL("./og.html", import.meta.url).href, { waitUntil: "networkidle0" });
await p.screenshot({ path: fileURLToPath(new URL("../public/og.png", import.meta.url)) });
await b.close();
