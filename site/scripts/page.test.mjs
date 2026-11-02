// Behavioural tests of ticket 143's second part in headless Chrome, on one build: the hero headline's one turn
// (the sequence, the rest on "Settle in.", the pauses, reduced motion, no layout shift) and the Remote stage
// (#how): pinned and driven by the scroll from 900 px, forward and back; a step's button scrolls to its step;
// unpinned with Replay on phones and under reduced motion; the TV and phone proportions.
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

const tmp = skip ? "" : mkdtempSync(join(tmpdir(), "couch-page-"));
let browser, server, url;
before(async () => {
  if (skip) return;
  const out = join(tmp, "dist");
  execFileSync(join(root, "node_modules/.bin/vite"), ["build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: root, stdio: "inherit" });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(out, path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(out) || !existsSync(file)) file = join(out, "404.html");
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: chrome, headless: true });
});
after(async () => { await browser?.close(); server?.close(); if (tmp) rmSync(tmp, { recursive: true, force: true }); });

/** A fresh tab (a fresh session, so the intro plays), with the page's layout shifts summed from the start. */
async function open({ width = 1280, height = 860, reduce = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  if (reduce) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    // the drawn UI is inert, and inert is skipped by hit testing; lift it for a moment to see what is on top
    window.inFront = (x, y) => {
      const inert = [...document.querySelectorAll("[data-seq] [inert]")];
      inert.forEach((e) => { e.inert = false; });
      const hit = document.elementFromPoint(x, y)?.closest(".phone, .tv");
      inert.forEach((e) => { e.inert = true; });
      return !!hit?.matches(".phone");
    };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(url, { waitUntil: "load" });
  // count shifts from here: the web font's swap at first paint is not this ticket's (the intro hides it anyway)
  await page.evaluate(() => document.fonts.ready.then(() => { window.__cls = 0; }));
  return page;
}

/** The headline now: which phrases show (opacity > .5), the rotation state, its text and its box. */
const head = (page) => page.evaluate(() => {
  const h1 = document.querySelector(".hero h1");
  const shown = [...h1.children].filter((e) => Number(getComputedStyle(e).opacity) > 0.5).map((e) => e.dataset.text ?? e.textContent);
  // the layout box (offsets), not the painted one: the intro moves the copy with a transform
  return { shown: shown.join("+"), state: h1.dataset.rotation, text: h1.textContent, box: [h1.offsetLeft, h1.offsetTop, h1.offsetWidth, h1.offsetHeight], cls: window.__cls };
});

describe("the hero headline turns once", { skip }, () => {
  test("after the intro: Settle in. → Sit back. → Press play. → Lights down. → rests on Settle in., with no layout shift", async () => {
    const page = await open();
    const first = await head(page);
    assert.equal(first.state, "waiting", "nothing turns while the intro plays");
    assert.equal(first.shown, "Settle in.");
    // a key skips the intro; the turn starts once it is done
    await page.keyboard.press("Shift");
    await page.waitForFunction(() => document.documentElement.classList.contains("intro-done"));
    const seen = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 14500) {
      const s = await head(page);
      if (s.shown && s.shown !== seen.at(-1)?.shown) seen.push({ ...s, t: Date.now() - t0 });
      await wait(80);
    }
    const phrases = seen.map((s) => s.shown).filter((v) => !v.includes("+"));
    assert.deepEqual(phrases, ["Settle in.", "Sit back.", "Press play.", "Lights down.", "Settle in."], JSON.stringify(seen));
    const at = (p, k = 0) => seen.filter((s) => s.shown === p)[k].t;
    for (const [a, b] of [["Sit back.", "Press play."], ["Press play.", "Lights down."]]) {
      const held = at(b) - at(a);
      assert.ok(held > 2200 && held < 3000, `${a} shows about 2.6s (${held} ms)`);
    }
    const end = await head(page);
    assert.equal(end.state, "rested");
    assert.equal(end.shown, "Settle in.");
    assert.ok(Date.now() - t0 - at("Settle in.", 1) > 1500, "it stays on Settle in.");
    assert.equal(end.text, "Settle in.", "the h1's text is only Settle in.");
    const ax = await page.accessibility.snapshot({ root: await page.$(".hero h1") });
    assert.equal(ax.name, "Settle in.", "screen readers hear Settle in.");
    assert.deepEqual(seen.map((s) => s.box.join()).filter((v, i, a) => a.indexOf(v) === i), [first.box.join()], "the h1's box never changes");
    assert.equal(end.cls, 0, "no layout shift");
    await page.close();
  });

  test("it waits while the pointer is on the headline", async () => {
    const page = await open();
    await page.keyboard.press("Shift");
    await page.waitForFunction(() => document.querySelector(".hero h1").dataset.rotation === "running");
    await page.hover(".hero h1");
    assert.equal((await head(page)).state, "paused");
    await wait(3400);
    assert.equal((await head(page)).shown, "Settle in.", "nothing turned while paused");
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => document.querySelector(".hero h1").dataset.showing === "1", { timeout: 4000 });
    await page.close();
  });

  test("with reduced motion it is Settle in., still", async () => {
    const page = await open({ reduce: true });
    await wait(3000);
    const s = await head(page);
    assert.equal(s.shown, "Settle in.");
    assert.equal(s.state, undefined, "the turn never starts");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".hero h1 > *").length), 1);
    assert.equal(s.cls, 0);
    await page.close();
  });
});

/** The stage now: data-stage, the current step, the rail, the track and pin, and whether Replay shows. */
const stage = (page) => page.evaluate(() => {
  const track = document.querySelector("[data-how-track]");
  return {
    stage: Number(document.querySelector("[data-seq]").dataset.stage),
    current: [...document.querySelectorAll('[data-go][aria-current="step"]')].map((b) => Number(b.dataset.go)),
    fill: Number(document.querySelector("[data-rail]").style.getPropertyValue("--fill") || 0),
    trackH: track.offsetHeight, pinH: track.firstElementChild.offsetHeight, trackTop: track.getBoundingClientRect().top + scrollY,
    pinTop: track.firstElementChild.getBoundingClientRect().top,
    sticky: getComputedStyle(track.firstElementChild).position === "sticky",
    replay: !document.querySelector("[data-replay]").hidden,
    vh: innerHeight,
  };
});
/** Scrolls (instantly) to a point along the pinned track: 0 as the stage pins, 1 as it lets go. */
async function scrollTrack(page, p) {
  const s = await stage(page);
  await page.evaluate((y) => { document.documentElement.style.scrollBehavior = "auto"; scrollTo(0, y); }, s.trackTop - 76 + p * (s.trackH - s.pinH));
  await wait(250);
  return stage(page);
}

describe("the Remote stage", { skip }, () => {
  test("from 900 px it pins and the scroll moves the steps forward and back", async () => {
    const page = await open({ width: 1440, height: 900 });
    const s0 = await stage(page);
    assert.ok(s0.sticky, "the stage is sticky");
    assert.ok(s0.trackH > 3 * s0.vh && s0.trackH < 4 * s0.vh, `about 3.4 screens of scroll (${s0.trackH})`);
    assert.equal(s0.replay, false, "no Replay: the scroll is the control");
    let fill = -1;
    for (const [p, n] of [[-0.2, 1], [0.1, 1], [0.37, 2], [0.62, 3], [0.87, 4], [1.2, 4]]) {
      const s = await scrollTrack(page, p);
      assert.equal(s.stage, n, `at ${p} the stage shows step ${n}`);
      assert.deepEqual(s.current, [n], "that step is the current one in the list");
      assert.ok(s.fill >= fill, "the rail only fills going down");
      fill = s.fill;
      if (p >= 0 && p <= 1) assert.ok(Math.abs(s.pinTop - 76) < 2, `pinned under the nav (${s.pinTop})`);
    }
    for (const [p, n] of [[0.62, 3], [0.37, 2], [0.1, 1], [-0.2, 1]]) {
      const s = await scrollTrack(page, p);
      assert.equal(s.stage, n, `back up at ${p}: step ${n}`);
      assert.deepEqual(s.current, [n]);
      assert.ok(s.fill <= fill, "the rail empties going up");
      fill = s.fill;
    }
    const tiles = await page.evaluate(() => [...document.querySelectorAll("[data-seq] .h-app.focused")].map((t) => t.dataset.id));
    assert.deepEqual(tiles, ["youtube"], "back at step 1 the highlight is back on YouTube");
    await page.close();
  });

  test("a step's button scrolls to its step; the wheel is never taken", async () => {
    const page = await open({ width: 1440, height: 900 });
    await scrollTrack(page, 0.05);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = ""; });
    const y0 = await page.evaluate(() => scrollY);
    await page.click('[data-go="3"]');
    await page.waitForFunction(() => document.querySelector("[data-seq]").dataset.stage === "3", { timeout: 4000 });
    await wait(1200);
    const s = await stage(page);
    assert.equal(s.stage, 3);
    assert.deepEqual(s.current, [3]);
    assert.ok((await page.evaluate(() => scrollY)) > y0, "the page scrolled down to step 3");
    await page.click('[data-go="1"]');
    await page.waitForFunction(() => document.querySelector("[data-seq]").dataset.stage === "1", { timeout: 4000 });
    const cdp = await page.createCDPSession();
    for (const target of ["window", "document"]) {
      const { result } = await cdp.send("Runtime.evaluate", { expression: target });
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
      assert.deepEqual(listeners.filter((l) => ["wheel", "mousewheel", "touchmove"].includes(l.type)).map((l) => l.type), [], `no wheel or touchmove listener on ${target}`);
    }
    await page.close();
  });

  test("on a phone it is not pinned: it plays once in view, ends connected, and Replay plays it again", async () => {
    const page = await open({ width: 390, height: 844 });
    let s = await stage(page);
    assert.equal(s.sticky, false);
    assert.ok(s.trackH < s.vh, "no long track");
    assert.equal(s.replay, true);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; document.querySelector("[data-seq]").scrollIntoView({ block: "center" }); });
    await page.waitForFunction(() => document.querySelector("[data-seq]").dataset.stage === "2", { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector("[data-seq]").dataset.stage === "4", { timeout: 6000 });
    await page.click("[data-replay]");
    assert.equal((await stage(page)).stage, 1, "Replay starts again");
    await page.waitForFunction(() => document.querySelector("[data-seq]").dataset.stage === "4", { timeout: 6000 });
    // the same proportions: the phone stands in front of the Screen's lower-right corner
    await page.evaluate(() => document.querySelector("[data-seq]").scrollIntoView({ block: "center" }));
    const geo = await page.evaluate(() => {
      const tv = document.querySelector("[data-seq] .tv-screen").getBoundingClientRect();
      const ph = document.querySelector("[data-seq] .phone").getBoundingClientRect();
      const x = (Math.max(tv.left, ph.left) + Math.min(tv.right, ph.right)) / 2, y = (Math.max(tv.top, ph.top) + Math.min(tv.bottom, ph.bottom)) / 2;
      return { tv: tv.toJSON(), ph: ph.toJSON(), front: inFront(x, y) };
    });
    assert.ok(geo.ph.left > geo.tv.left + geo.tv.width / 2 && geo.ph.left < geo.tv.right, "the phone overlaps the Screen's right half");
    assert.ok(geo.ph.top > geo.tv.top + geo.tv.height / 3 && geo.ph.top < geo.tv.bottom, "and its lower part");
    assert.ok(geo.front, "in front of it");
    s = await stage(page);
    assert.ok(s.trackH > 0);
    await page.close();
  });

  test("with reduced motion it is not pinned and shows the end, with Replay", async () => {
    const page = await open({ width: 1440, height: 900, reduce: true });
    await page.evaluate(() => document.querySelector("[data-seq]").scrollIntoView({ block: "center" }));
    await wait(600);
    const s = await stage(page);
    assert.equal(s.sticky, false);
    assert.equal(s.stage, 4);
    assert.deepEqual(s.current, [4]);
    assert.equal(s.replay, true);
    await page.close();
  });

  test("desktop proportions: the Screen is about two thirds of the content, the phone in front of its lower-right corner", async () => {
    const page = await open({ width: 1440, height: 900 });
    await scrollTrack(page, 0.5);
    const geo = await page.evaluate(() => {
      const wrap = document.querySelector(".how-stage").getBoundingClientRect();
      const tv = document.querySelector("[data-seq] .tv").getBoundingClientRect();
      const ph = document.querySelector("[data-seq] .phone").getBoundingClientRect();
      const x = (Math.max(tv.left, ph.left) + tv.right) / 2, y = (ph.top + tv.bottom) / 2;
      return { share: tv.width / wrap.width, phW: ph.width, tvR: tv.right, tvB: tv.bottom, ph: ph.toJSON(), front: inFront(x, y) };
    });
    assert.ok(geo.share > 0.63 && geo.share < 0.72, `Screen share ${geo.share.toFixed(3)}`);
    assert.ok(geo.phW >= 150 && geo.phW <= 200, `the phone at about its size (${geo.phW})`);
    assert.ok(geo.ph.left < geo.tvR && geo.ph.right > geo.tvR, "the phone crosses the Screen's right edge");
    assert.ok(geo.ph.top < geo.tvB && geo.ph.bottom > geo.tvB, "and its bottom edge");
    assert.ok(geo.front, "in front of it");
    await page.close();
  });
});
