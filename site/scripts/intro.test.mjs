// Behavioural tests of the hero intro (tickets 139, 142 and 143) in headless Chrome, for both INTRO_MODE values (src/config.ts).
// Builds the site once per mode (COUCH_INTRO_MODE), serves each build on a free port, and checks that a click or
// focus without a pointer, a resize and a return from the back/forward cache all end the intro with the hero
// copy, the buttons and the glowing picture fully visible, and that the intro's listeners are gone afterwards;
// and the ticket 143 timeline (COUCH holds a beat; the copy arrives over the last moments of the ~3.2s morph).
// The page's animation clock is slowed (DevTools playback rate) so every trigger lands mid-intro.
// Needs Google Chrome (CHROME overrides the path); skipped without it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import puppeteer from "puppeteer-core";

const root = resolve(import.meta.dirname, "..");
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const skip = existsSync(chrome) ? false : `no Chrome at ${chrome}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };

/** A tiny static server for one build, on a free port. */
function serve(dir) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(dir, path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(dir) || !existsSync(file)) file = join(dir, "404.html");
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const tmp = skip ? "" : mkdtempSync(join(tmpdir(), "couch-intro-"));
let browser;
before(async () => { if (!skip) browser = await puppeteer.launch({ executablePath: chrome, headless: true }); });
after(async () => { await browser?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

/** The hero right now: html classes, the copy's and the picture's opacity, whether the intro SVG shows. */
const hero = (page) => page.evaluate(() => {
  const o = (el) => Number(getComputedStyle(el).opacity);
  return {
    cls: document.documentElement.className,
    copy: [...document.querySelectorAll(".hero-copy > :not(.mark)")].map(o),
    lamp: o(document.querySelector(".lamp")),
    svg: getComputedStyle(document.querySelector("svg.wm-intro")).display,
    dust: document.querySelectorAll(".wm-dust").length,
  };
});

/** The window's listeners of the intro's kinds (main.ts keeps one non-capture scroll and one resize of its own). */
async function introListeners(page, cdp) {
  const { result } = await cdp.send("Runtime.evaluate", { expression: "window" });
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
  const kinds = ["wheel", "touchstart", "pointerdown", "keydown", "scroll", "click", "focusin", "resize", "orientationchange", "pageshow"];
  return listeners.filter((l) => kinds.includes(l.type) && (l.useCapture || !["scroll", "resize"].includes(l.type)))
    .map((l) => `${l.type}${l.useCapture ? " (capture)" : ""}`);
}

for (const mode of ["sequence", "logo-only"]) {
  describe(`hero intro, INTRO_MODE ${mode}`, { skip }, () => {
    let server, url;
    before(async () => {
      const out = join(tmp, mode);
      execFileSync(join(root, "node_modules/.bin/vite"), ["build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"],
        { cwd: root, env: { ...process.env, COUCH_INTRO_MODE: mode }, stdio: "inherit" });
      server = await serve(out);
      url = `http://127.0.0.1:${server.address().port}/`;
    });
    after(() => server?.close());

    /** A fresh tab (a fresh session, so the intro plays) at 1/10 speed, waiting until the intro runs. */
    async function open() {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 860 });
      const cdp = await page.createCDPSession();
      await cdp.send("Animation.enable");
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector("svg.wm-intro")?.getAnimations().length > 0);
      const s = await hero(page);
      assert.match(s.cls, /\bintro\b/);
      assert.doesNotMatch(s.cls, /intro-(skip|done)/, "the intro is still running when the trigger comes");
      assert.equal(s.lamp, 0, "the glowing picture waits for the morph");
      if (mode === "sequence") assert.ok(s.copy.every((v) => v < 0.05), `the copy waits for the logo: ${s.copy}`);
      else assert.ok(s.copy.every((v) => v === 1), `the copy is there from the first paint: ${s.copy}`);
      assert.equal(s.cls.includes("intro-logo"), mode === "logo-only");
      assert.equal(s.dust, 1, "the dust canvas is there while the intro plays");
      return { page, cdp };
    }

    /** After a trigger: skipped, then (back at full speed) everything visible, the intro gone, its listeners gone. */
    async function finished({ page, cdp }, cls = "intro-skip") {
      assert.match((await hero(page)).cls, new RegExp(`\\b${cls}\\b`));
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
      await wait(600);
      const s = await hero(page);
      assert.match(s.cls, /\bintro-done\b/);
      assert.deepEqual(s.copy, s.copy.map(() => 1), "headline, text, buttons and meta are fully visible");
      assert.equal(s.lamp, 1, "the glowing picture is shown");
      assert.equal(s.svg, "none");
      assert.equal(s.dust, 0, "the dust canvas is removed");
      assert.deepEqual(await introListeners(page, cdp), []);
      await page.close();
    }

    test("a click without a pointer (assistive tech, element.click()) skips", async () => {
      const t = await open();
      await t.page.evaluate(() => {
        const a = document.querySelector(".hero .cta .btn-primary");
        a.addEventListener("click", (e) => e.preventDefault(), { once: true });
        a.click();
      });
      await finished(t);
    });

    test("focus moved onto a hero control without a key skips", async () => {
      const t = await open();
      await t.page.evaluate(() => document.querySelector(".hero .cta .sub").focus());
      await finished(t);
    });

    test("a resize skips (the wordmark was sized for the first viewport)", async () => {
      const t = await open();
      await t.page.setViewport({ width: 900, height: 860 });
      await finished(t);
    });

    test("a return from the back/forward cache shows the end at once", async () => {
      const t = await open();
      await t.page.evaluate(() => { window.stayed = true; });
      await t.page.goto(url + "robots.txt");
      await t.page.goBack();
      assert.equal(await t.page.evaluate(() => window.stayed), true, "the page came back from the back/forward cache");
      const s = await hero(t.page);
      // at once: no fade left to run, even at 1/10 speed
      assert.deepEqual(s.copy, s.copy.map(() => 1));
      assert.equal(s.lamp, 1);
      assert.equal(s.svg, "none");
      await finished(t, "intro-now");
    });

    test("without a trigger it plays to the end on its own", async () => {
      const t = await open();
      await t.cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
      await t.page.waitForFunction(() => document.documentElement.classList.contains("intro-done"), { timeout: 7000 });
      await wait(700); // the intro is done at 3.55s; the last copy fade (sequence) ends at 3.8s
      const s = await hero(t.page);
      assert.doesNotMatch(s.cls, /intro-skip/);
      assert.deepEqual(s.copy, s.copy.map(() => 1));
      assert.equal(s.lamp, 1);
      assert.equal(s.dust, 0);
      assert.deepEqual(await introListeners(t.page, t.cdp), []);
      await t.page.close();
    });

    test("the cinematic timeline: COUCH holds a beat, the copy arrives over the morph's last moments", async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 860 });
      const cdp = await page.createCDPSession();
      await cdp.send("Animation.enable");
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.5 });
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector("svg.wm-intro")?.getAnimations().length > 0);
      /** Waits until the intro's own clock (the svg's fade-out animation) reaches `ms`, then reads the hero. */
      const at = async (ms) => {
        await page.waitForFunction((ms) => {
          const a = document.querySelector("svg.wm-intro").getAnimations().find((x) => x.animationName === "intro-out");
          return !a || document.timeline.currentTime - a.startTime >= ms;
        }, { polling: "raf", timeout: 15000 }, ms);
        return page.evaluate(() => ({
          u: document.querySelector("svg.wm-intro .l-u").getAttribute("d"),
          o: document.querySelector("svg.wm-intro .l-o").getAttribute("d"),
          dusting: document.querySelector("svg.wm-intro").classList.contains("dusting"),
          copy: [...document.querySelectorAll(".hero-copy > :not(.mark)")].map((el) => Number(getComputedStyle(el).opacity)),
          lamp: Number(getComputedStyle(document.querySelector(".lamp")).opacity),
          cls: document.documentElement.className,
        }));
      };
      const risen = await at(800);
      const held = await at(1150);
      assert.equal(held.u, risen.u, "the U has not moved yet: COUCH holds");
      assert.equal(held.o, risen.o, "the O has not moved yet: COUCH holds");
      assert.equal(held.dusting, false, "the C, C and H have not started to dissolve");
      const moving = await at(1900);
      assert.notEqual(moving.u, held.u, "the U is widening");
      assert.equal(moving.dusting, true, "the C, C and H are dust");
      const before = await at(2450);
      assert.equal(before.lamp, 0, "the glowing picture waits for the hand-off");
      if (mode === "sequence") assert.ok(before.copy.every((v) => v < 0.05), `no copy before 2.6s: ${before.copy}`);
      const overlap = await at(3050);
      assert.doesNotMatch(overlap.cls, /intro-(done|skip)/, "the morph is still on screen");
      assert.ok(overlap.copy[1] > 0.3, `the headline arrives while the logo completes: ${overlap.copy}`);
      assert.ok(overlap.lamp > 0, "the glowing picture is taking over");
      if (mode === "logo-only") assert.ok([before, overlap].every((s) => s.copy.every((v) => v === 1)), "logo-only: the copy is always there");
      await page.close();
    });

    test("with reduced motion there is no intro and no dust: the finished hero at once", async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 860 });
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await page.goto(url, { waitUntil: "load" });
      const s = await hero(page);
      assert.doesNotMatch(s.cls, /\bintro\b/);
      assert.deepEqual(s.copy, s.copy.map(() => 1));
      assert.equal(s.lamp, 1);
      assert.equal(s.svg, "none");
      assert.equal(s.dust, 0);
      assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length), 0);
      await page.close();
    });
  });
}
