// Behavioural tests of ticket 143's second part in headless Chrome, on one build: the hero headline's loop and its
// line (the order, round again, the segments, the pauses, reduced motion, no layout shift) and the Remote stage
// (#how): pinned and driven by the scroll from 900 px, forward and back; a step's button scrolls to its step;
// unpinned with Replay on phones and under reduced motion; the TV and phone proportions; and the first-look TV's
// size, growth and pin (its live Home is scripts/launch.test.mjs).
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

/** A fresh tab (a fresh session, so the intro plays), with the page's layout shifts summed two ways: __clsAll over
 *  the whole navigation (the font swap included) and __cls from the moment the web font is in (the motion's own). */
async function open({ width = 1280, height = 860, reduce = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  if (reduce) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    window.__clsAll = 0;
    // the drawn UI is inert, and inert is skipped by hit testing; lift it for a moment to see what is on top
    window.inFront = (x, y) => {
      const inert = [...document.querySelectorAll("[data-seq] [inert]")];
      inert.forEach((e) => { e.inert = false; });
      const hit = document.elementFromPoint(x, y)?.closest(".phone, .tv");
      inert.forEach((e) => { e.inert = true; });
      return !!hit?.matches(".phone");
    };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__cls += e.value; window.__clsAll += e.value; })).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(url, { waitUntil: "load" });
  // __cls counts from here: the motion's shifts only, apart from the font's swap at first paint
  await page.evaluate(() => document.fonts.ready.then(() => { window.__cls = 0; }));
  return page;
}

/** The headline now: which phrases show (opacity > .5), the rotation state, its text and its box, and the line under
 *  it: each segment's fill (0–1), whether it shows, and where it sits. */
const head = (page) => page.evaluate(() => {
  const h1 = document.querySelector(".hero h1");
  const shown = [...h1.children].filter((e) => Number(getComputedStyle(e).opacity) > 0.5).map((e) => e.dataset.text ?? e.textContent);
  const bar = document.querySelector(".h1-steps");
  const fills = [...bar.querySelectorAll("i > b")].map((b) => {
    const m = getComputedStyle(b).transform.match(/^matrix\(([^,]+)/);
    return m ? Number(m[1]) : 1;
  });
  const segs = [...bar.querySelectorAll("i")].map((i) => i.getBoundingClientRect());
  const hr = h1.getBoundingClientRect(), lead = document.querySelector(".hero .lead").getBoundingClientRect();
  // the layout box (offsets), not the painted one: the intro moves the copy with a transform
  return { shown: shown.join("+"), state: h1.dataset.rotation, showing: h1.dataset.showing, text: h1.textContent,
    box: [h1.offsetLeft, h1.offsetTop, h1.offsetWidth, h1.offsetHeight], lead: document.querySelector(".hero .lead").offsetTop, fills,
    bar: { display: getComputedStyle(bar).display, op: Number(getComputedStyle(bar).opacity), h1Op: Number(getComputedStyle(h1).opacity),
      mid: segs.length ? (segs[0].left + segs.at(-1).right) / 2 - (hr.left + hr.right) / 2 : null,
      top: segs.length ? segs[0].top - hr.bottom : null, room: lead.top - hr.bottom, h: segs[0]?.height ?? 0 },
    cls: window.__cls, clsAll: window.__clsAll };
});
/** Turns reduced motion on (or off) while the page runs; matchMedia's change event follows. */
const setReduce = (page, on) => page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }]);
const near = (a, b, d = 0.02) => Math.abs(a - b) <= d;

describe("the hero headline loops, with its line", { skip }, () => {
  test("after the intro: Settle in. → Sit back. → Press play. → Lights down. → Settle in. → Sit back. …, the line filling with it, with no layout shift", async () => {
    const page = await open();
    const first = await head(page);
    assert.equal(first.state, "waiting", "nothing turns while the intro plays");
    assert.equal(first.shown, "Settle in.");
    assert.equal(first.fills.length, 4, "a segment per phrase");
    assert.ok(near(first.bar.op, first.bar.h1Op, 0.05), `the line arrives with the headline (${first.bar.op} / ${first.bar.h1Op})`);
    // a key skips the intro; the loop starts once it is done
    await page.keyboard.press("Shift");
    await page.waitForFunction(() => document.documentElement.classList.contains("intro-done"));
    const polls = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 16500) {
      polls.push({ ...(await head(page)), t: Date.now() - t0 });
      await wait(80);
    }
    const seen = polls.filter((s, i) => s.shown && s.shown !== polls.slice(0, i).findLast((p) => p.shown)?.shown);
    const phrases = seen.map((s) => s.shown).filter((v) => !v.includes("+"));
    assert.deepEqual(phrases, ["Settle in.", "Sit back.", "Press play.", "Lights down.", "Settle in.", "Sit back."], JSON.stringify(seen.map((s) => [s.shown, s.t])));
    const at = (p, k = 0) => seen.filter((s) => s.shown === p)[k].t;
    for (const [a, b] of [["Sit back.", "Press play."], ["Press play.", "Lights down."], ["Lights down.", "Settle in."]]) {
      const held = at(b, a === "Lights down." ? 1 : 0) - at(a);
      assert.ok(held > 2600 && held < 3400, `${a} shows about 3s (${held} ms)`);
    }
    // mid "Press play.": the two before it full, its own filling, the last empty
    const mid = polls.find((s) => s.shown === "Press play." && s.t > at("Press play.") + 1000);
    assert.ok(near(mid.fills[0], 1) && near(mid.fills[1], 1), `done segments stay full: ${mid.fills}`);
    assert.ok(mid.fills[2] > 0.2 && mid.fills[2] < 0.95, `the current one is filling: ${mid.fills}`);
    assert.equal(mid.fills[3], 0, "the next is empty");
    // back on "Settle in.": the line starts again
    const again = polls.find((s) => s.shown === "Settle in." && s.t > at("Settle in.", 1) + 700);
    assert.deepEqual(again.fills.slice(1), [0, 0, 0], `the loop restarts the line: ${again.fills}`);
    assert.ok(again.fills[0] > 0 && again.fills[0] < 0.6, `and fills the first again: ${again.fills}`);
    const end = polls.at(-1);
    assert.equal(end.state, "running", "it keeps going");
    assert.equal(end.text, "Settle in.", "the h1's text is only Settle in.");
    const ax = await page.accessibility.snapshot({ root: await page.$(".hero h1") });
    assert.equal(ax.name, "Settle in.", "screen readers hear Settle in.");
    assert.deepEqual(polls.map((s) => s.box.join()).filter((v, i, a) => a.indexOf(v) === i), [first.box.join()], "the h1's box never changes");
    // the line: small, centred under the h1, in the gap above the lead
    assert.ok(Math.abs(end.bar.mid) < 1, `centred (${end.bar.mid})`);
    assert.ok(end.bar.top > 0 && end.bar.top + end.bar.h < end.bar.room, `in the gap under the h1 (${end.bar.top} of ${end.bar.room})`);
    assert.equal(end.cls, 0, "no layout shift");
    await page.close();
  });

  test("it waits while the pointer is on the headline, and the line waits with it", async () => {
    const page = await open();
    await page.keyboard.press("Shift");
    await page.waitForFunction(() => document.querySelector(".hero h1").dataset.showing === "1", { timeout: 6000 });
    await wait(1000);
    await page.hover(".hero h1");
    const paused = await head(page);
    assert.equal(paused.state, "paused");
    await wait(3400);
    const still = await head(page);
    assert.equal(still.shown, "Sit back.", "nothing turned while paused");
    assert.ok(near(still.fills[1], paused.fills[1], 0.01), `the segment held still (${paused.fills[1]} → ${still.fills[1]})`);
    await page.mouse.move(5, 5);
    await wait(250);
    const after = await head(page);
    assert.equal(after.state, "running");
    assert.ok(after.fills[1] > still.fills[1] && after.fills[1] < still.fills[1] + 0.2, `it goes on from where it was, no jump (${still.fills[1]} → ${after.fills[1]})`);
    await page.waitForFunction(() => document.querySelector(".hero h1").dataset.showing === "2", { timeout: 3000 });
    await page.close();
  });

  test("it waits while something in the hero has focus (the keyboard's pause)", async () => {
    const page = await open();
    await page.keyboard.press("Shift");
    await page.waitForFunction(() => document.querySelector(".hero h1").dataset.rotation === "running");
    await page.focus(".hero .cta .btn");
    const paused = await head(page);
    assert.equal(paused.state, "paused");
    await wait(3400);
    const still = await head(page);
    assert.equal(still.shown, paused.shown, "nothing turned while focused");
    assert.deepEqual(still.fills, paused.fills, "the line held still");
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => document.querySelector(".hero h1").dataset.rotation === "running", { timeout: 1000 });
    await page.close();
  });

  test("with reduced motion it is Settle in., still, and there is no line", async () => {
    const page = await open({ reduce: true });
    await wait(3000);
    const s = await head(page);
    assert.equal(s.shown, "Settle in.");
    assert.equal(s.state, undefined, "the loop never starts");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".hero h1 > *").length), 1);
    assert.equal(s.bar.display, "none", "no line");
    assert.equal(s.fills.length, 0);
    assert.equal(s.cls, 0, "no shift once the font is in");
    assert.equal(s.clsAll, 0, "and none over the whole navigation, the font's swap included");
    await page.close();
  });

  for (const [when, ready] of [
    ["while a phrase shows", async (page) => page.waitForFunction(() => document.querySelector('.hero h1 [data-text="Press play."]') && getComputedStyle(document.querySelector('.hero h1 [data-text="Press play."]')).opacity > 0.5, { timeout: 15000 })],
    ["as the loop comes back to Settle in.", async (page) => {
      await page.waitForFunction(() => document.querySelector(".hero h1").dataset.showing === "3", { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector(".hero h1").dataset.showing === "0", { timeout: 5000 });
    }],
  ]) {
    test(`a switch to reduced motion ${when} puts Settle in. back at once and hides the line, for good`, async () => {
      const page = await open();
      await page.keyboard.press("Shift");
      await ready(page);
      const before = await head(page);
      await setReduce(page, true);
      await page.waitForFunction(() => document.querySelector(".hero h1").dataset.rotation === "stopped", { timeout: 1000 });
      let s = await head(page);
      assert.equal(s.lead, before.lead, "the copy under the h1 stays put as the line goes");
      assert.equal(s.shown, "Settle in.", "back at once");
      assert.equal(s.state, "stopped");
      assert.equal(s.bar.display, "none", "no line");
      await setReduce(page, false);
      await wait(3400);
      s = await head(page);
      assert.equal(s.shown, "Settle in.", "and it does not start again");
      assert.equal(s.state, "stopped");
      assert.equal(s.bar.display, "none", "and the line stays gone");
      await page.close();
    });
  }

  test("a resize while Lights down. shows (1440 → 320) fits the phrase on screen at once", async () => {
    const page = await open({ width: 1440, height: 900 });
    await page.keyboard.press("Shift");
    await page.waitForFunction(() => document.querySelector(".hero h1").dataset.showing === "3", { timeout: 15000 });
    await wait(1100); // Lights down. is fully in
    await page.setViewport({ width: 320, height: 640 });
    await wait(120);
    const fit = await page.evaluate(() => {
      const el = document.querySelector('.hero h1 [data-text="Lights down."]');
      const r = el.getBoundingClientRect();
      const col = document.querySelector(".hero-copy").getBoundingClientRect();
      return { left: r.left, right: r.right, colL: col.left, colR: col.right, op: Number(getComputedStyle(el).opacity) };
    });
    assert.ok(fit.op > 0.9, "Lights down. is the phrase on screen");
    assert.ok(fit.left >= fit.colL - 1 && fit.right <= fit.colR + 1, `it fits the column (${fit.left.toFixed(1)}–${fit.right.toFixed(1)} in ${fit.colL}–${fit.colR})`);
    await page.close();
  });
});

describe("the font's swap", { skip }, () => {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    test(`at ${w} with reduced motion the whole navigation has no layout shift`, async () => {
      const page = await open({ width: w, height: h, reduce: true });
      await wait(1500);
      const s = await head(page);
      assert.equal(s.clsAll, 0, `whole-navigation CLS ${s.clsAll}`);
      const cta = await page.$eval(".nav-cta .btn-primary", (a) => ({ text: a.textContent.trim(), href: a.getAttribute("href"), shown: a.offsetWidth > 0 }));
      assert.deepEqual(cta, { text: "Download", href: "#download", shown: true }, "the nav's button says Download, not the name beside it");
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('link[rel="preload"][as="font"]')].some((l) => /Geist-Variable-[\w-]+\.woff2$/.test(l.href) && l.crossOrigin === "anonymous")), "Geist is preloaded, from its built URL");
      await page.close();
    });
  }

  test("even when Geist arrives late (held back 1.2 s), the metric-matched fallback keeps the swap still", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setRequestInterception(true);
    page.on("request", (r) => { if (r.url().endsWith(".woff2")) setTimeout(() => r.continue().catch(() => {}), 1200); else r.continue().catch(() => {}); });
    await page.evaluateOnNewDocument(() => {
      window.__clsAll = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__clsAll += e.value; })).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await wait(500);
    const cls = await page.evaluate(() => window.__clsAll);
    assert.ok(cls < 0.001, `CLS with a late font ${cls}`);
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
    stickyTop: parseFloat(getComputedStyle(track.firstElementChild).top) || 0,
    navBottom: document.querySelector(".nav-in").getBoundingClientRect().bottom,
    headTop: document.querySelector("#how .eyebrow").getBoundingClientRect().top,
    headBottom: document.querySelector("#how-h").getBoundingClientRect().bottom,
    sticky: getComputedStyle(track.firstElementChild).position === "sticky",
    replay: !document.querySelector("[data-replay]").hidden,
    vh: innerHeight,
  };
});
/** Scrolls (instantly) to a point along the pinned track: 0 as the stage pins, 1 as it lets go. */
async function scrollTrack(page, p) {
  const s = await stage(page);
  await page.evaluate((y) => { document.documentElement.style.scrollBehavior = "auto"; scrollTo(0, y); }, s.trackTop - s.stickyTop + p * (s.trackH - s.pinH));
  await wait(250);
  return stage(page);
}

/** The first-look TV's scale with the track's top `y` px from the window's top (the TV pins when it reaches the nav, 66). */
async function tvAt(page, y) {
  await page.evaluate((y) => {
    const t = document.querySelector("[data-fl-track]");
    let top = 0;
    for (let el = t; el; el = el.offsetParent) top += el.offsetTop;
    document.documentElement.style.scrollBehavior = "auto";
    scrollTo(0, top - y);
  }, y);
  await wait(200);
  return page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".first-look .tv")).scale;
    return s === "none" ? 1 : Number(s.split(" ")[0]);
  });
}

describe("the first-look TV: as big as the window holds, growing as it comes in, pinned", { skip }, () => {
  // [width, height, the TV's expected width (± 2 px)]: the gutter (24 px, 16 px on phones), or the width at which the
  // pinned group (the TV: the 16:10 Screen, its 9 px bezel and the 14 px stand; then 16 px and Skip's 30 px) fits
  // between the nav and the window's bottom with at least 32 px (3.5vh) above and below
  for (const [w, h, tvW] of [[1440, 900, 1125.2], [1024, 768, 914], [390, 844, 358]]) {
    test(`at ${w} × ${h}: ${tvW} px wide, .85 as it enters, 1 as it pins, scale only, whole below the nav while pinned`, async () => {
      const page = await open({ width: w, height: h });
      const box = () => page.evaluate(() => { const tv = document.querySelector(".first-look .tv"); return [tv.offsetLeft, tv.offsetWidth, tv.offsetHeight].join(); });
      const before = await box();
      const size = await page.evaluate(() => { const tv = document.querySelector(".first-look .tv"); return { w: tv.offsetWidth, h: tv.offsetHeight }; });
      assert.ok(near(size.w, tvW, 2), `width ${size.w}`);
      assert.ok(size.h <= h - 66 - 64 - 46 + 1, `the TV fits below the nav, with the gaps and Skip (${size.h} of ${h - 66})`);
      const enter = await tvAt(page, h), half = await tvAt(page, (h + 66) / 2), pinned = await tvAt(page, 66);
      const rects = [];
      for (const y of [66, 66 - h * 0.5, 66 - h * 1.2]) {
        assert.ok(near(await tvAt(page, y), 1, 0.002), `full size while pinned (${y})`);
        rects.push(await page.evaluate(() => document.querySelector(".first-look .tv").getBoundingClientRect().toJSON()));
      }
      assert.ok(near(enter, 0.85, 0.005), `entering ${enter}`);
      assert.ok(near(half, 0.925, 0.01), `half way ${half}`);
      assert.ok(near(pinned, 1, 0.002), `pinned ${pinned}`);
      for (const r of rects) {
        assert.ok(r.left >= 0 && r.right <= w && r.top >= 66 && r.bottom <= h, `whole, below the nav, while pinned: ${JSON.stringify(r)}`);
        assert.ok(near(r.top, rects[0].top, 1), "and it stays put");
      }
      if (w <= 700) assert.ok(near(rects[0].left, 16, 1) && near(w - rects[0].right, 16, 1), `edge to edge but the gutter: ${rects[0].left}, ${w - rects[0].right}`);
      assert.equal(await box(), before, "the layout box never changes");
      assert.equal(await page.evaluate(() => window.__cls), 0, "no layout shift");
      // the Remote section starts below the first look, clear of it
      const gap = await page.evaluate(() => document.querySelector("#how").getBoundingClientRect().top - document.querySelector(".first-look").getBoundingClientRect().bottom);
      assert.ok(gap >= 0, `the Remote section follows the first look (${gap})`);
      await page.close();
    });
  }

  // (on windows this tall the TV already shows at load, so the growth is checked on the sizes above)
  for (const [w, h, tvW] of [[1920, 1080, 1394.6], [2560, 1440, 1600]]) {
    test(`at ${w} × ${h}: ${tvW} px wide (1600 at most), fitting below the nav`, async () => {
      const page = await open({ width: w, height: h });
      const size = await page.$eval(".first-look .tv", (tv) => ({ w: tv.offsetWidth, h: tv.offsetHeight }));
      assert.ok(near(size.w, tvW, 2), `width ${size.w}`);
      assert.ok(size.h <= h - 66 - 2 * Math.max(32, Math.min(56, 0.035 * h)) - 46 + 1, `height ${size.h}`);
      await page.close();
    });
  }

  // the pinned group (the TV and Skip; on phones the TV, the Remote, its caption and Skip) centred between the nav and
  // the window's bottom: the same gap above and below, at least 32 px (20 px on phones), nothing out of the window
  for (const [w, h, phone] of [[1440, 900, false], [1920, 1080, false], [1024, 768, false], [390, 844, true], [360, 740, true], [375, 667, true]]) {
    test(`at ${w} × ${h} the pinned group is centred below the nav, with even gaps`, async () => {
      const page = await open({ width: w, height: h });
      const min = phone ? 20 : 32;
      for (const y of [66, 66 - h * 0.6]) {
        await tvAt(page, y);
        const g = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const tv = r(".first-look .tv"), skip = r("[data-skip]"), remote = r("[data-remote]");
          return { top: tv.top, bottom: skip.bottom, skip: [skip.top, skip.bottom], remote: [remote.top, remote.bottom, remote.height], tv: [tv.top, tv.bottom, tv.left, tv.right],
            skipShown: getComputedStyle(document.querySelector("[data-skip]")).visibility === "visible", remoteShown: getComputedStyle(document.querySelector("[data-remote]")).display !== "none" };
        });
        const above = g.top - 66, below = h - g.bottom;
        assert.ok(Math.abs(above - below) <= 3, `centred: ${above} above, ${below} below`);
        assert.ok(above >= min - 1 && below >= min - 1, `at least ${min}px each: ${above}, ${below}`);
        assert.ok(g.tv[2] >= 0 && g.tv[3] <= w, "nothing out of the window");
        assert.ok(g.skipShown, "Skip shows while pinned");
        assert.ok(g.skip[0] >= g.tv[1] + 15, "Skip under the TV");
        assert.equal(g.remoteShown, phone, phone ? "the Remote on a phone" : "no Remote");
        if (phone) assert.ok(g.remote[0] >= g.tv[1] + 11 && g.remote[1] <= g.skip[0] - 11 && g.remote[2] > 150, `the Remote between the TV and Skip, 12px apart: ${JSON.stringify(g)}`);
      }
      assert.equal(await page.evaluate(() => window.__cls), 0, "no layout shift");
      await page.close();
    });
  }

  test("with reduced motion it is full size wherever it is, and not pinned", async () => {
    const page = await open({ width: 1440, height: 900, reduce: true });
    for (const y of [900, 400, 66]) assert.equal(await tvAt(page, y), 1);
    assert.equal(await page.$eval("[data-fl-track] > .fl-pin", (e) => getComputedStyle(e).position), "static");
    await page.close();
  });
});

describe("the Remote stage", { skip }, () => {
  test("from 900 px it pins and the scroll moves the steps forward and back", async () => {
    const page = await open({ width: 1440, height: 900 });
    const s0 = await stage(page);
    assert.ok(s0.sticky, "the stage is sticky");
    assert.ok(s0.trackH > 3 * s0.vh && s0.trackH < 4 * s0.vh, `about 3.4 screens of scroll (${s0.trackH})`);
    assert.equal(s0.replay, false, "no Replay: the scroll is the control");
    let fill = -1;
    for (const [p, n] of [[-0.2, 1], [0.15, 1], [0.42, 2], [0.7, 3], [0.92, 4], [1.2, 4]]) {
      const s = await scrollTrack(page, p);
      assert.equal(s.stage, n, `at ${p} the stage shows step ${n}`);
      assert.deepEqual(s.current, [n], "that step is the current one in the list");
      assert.ok(s.fill >= fill, "the rail only fills going down");
      fill = s.fill;
      if (p >= 0 && p <= 1) assert.ok(Math.abs(s.pinTop - s.stickyTop) < 2, `pinned under the nav (${s.pinTop})`);
    }
    for (const [p, n] of [[0.7, 3], [0.42, 2], [0.15, 1], [-0.2, 1]]) {
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

  test("pacing: the pairing and the highlight's move get the long stretches, the end holds only briefly", async () => {
    const page = await open({ width: 1440, height: 900 });
    const at = async (p) => (await scrollTrack(page, p)).stage;
    assert.equal(await at(0.28), 1, "still the QR code at 28 %");
    assert.equal(await at(0.32), 2, "paired from 30 %");
    assert.equal(await at(0.53), 2);
    assert.equal(await at(0.57), 3, "the press from 55 %");
    assert.equal(await at(0.82), 3, "still the press at 82 %");
    assert.equal(await at(0.86), 4, "the highlight moves at 84 %");
    const s = await stage(page);
    const hold = 0.16 * (s.trackH - s.pinH);
    assert.ok(hold < 0.6 * s.vh, `step 4 holds ${Math.round(hold)} px before the stage lets go`);
    await page.close();
  });

  for (const [w, h] of [[1440, 900], [1024, 768]]) {
    test(`at ${w} × ${h} the headline is pinned with the stage, below the nav, never under it`, async () => {
      const page = await open({ width: w, height: h });
      for (const p of [0, 0.3, 0.6, 1]) {
        const s = await scrollTrack(page, p);
        assert.ok(s.sticky);
        assert.ok(s.headTop >= s.navBottom + 4, `at ${p} the eyebrow (${s.headTop}) is below the nav (${s.navBottom})`);
        assert.ok(s.headBottom < s.vh, "and the headline is on screen");
        const phone = await page.evaluate(() => document.querySelector("[data-seq] .phone").getBoundingClientRect().bottom);
        assert.ok(phone <= s.vh, `the phone is on screen (${phone} ≤ ${s.vh})`);
      }
      await page.close();
    });
  }

  test("at 1440 × 700 (too short to pin with the headline) it plays in view, with Replay", async () => {
    const page = await open({ width: 1440, height: 700 });
    const s = await stage(page);
    assert.equal(s.sticky, false);
    assert.equal(s.replay, true);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; document.querySelector(".how-stage").scrollIntoView({ block: "center" }); });
    await page.waitForFunction(() => document.querySelector("[data-seq]").dataset.stage === "2", { timeout: 5000 });
    await page.close();
  });

  test("the track is measured again when the layout above it changes; far from it, a scroll writes nothing", async () => {
    const page = await open({ width: 1440, height: 900 });
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.style.height = "420px";
      document.querySelector(".first-look").append(d);
    });
    await wait(100);
    for (const [p, n] of [[0.15, 1], [0.42, 2], [0.7, 3], [0.92, 4]]) assert.equal((await scrollTrack(page, p)).stage, n, `after the change, ${p} is still step ${n}`);
    const writes = await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = "auto";
      scrollTo(0, document.querySelector("#faq").getBoundingClientRect().top + scrollY);
      await new Promise((r) => setTimeout(r, 200));
      let n = 0;
      const mo = new MutationObserver((m) => { n += m.length; });
      mo.observe(document.querySelector("#how"), { attributes: true, subtree: true });
      for (let k = 0; k < 12; k++) { scrollBy(0, 40); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
      mo.disconnect();
      return n;
    });
    assert.equal(writes, 0, "no writes to the stage while it is out of sight");
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
    assert.equal(s.trackH, s.pinH, "no extra scroll: the track is just the head and the stage");
    assert.equal(s.replay, true);
    // the devices half in view from below, the steps still under the fold: it waits
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const d = document.querySelector("[data-seq] .seq-devices");
      scrollTo(0, d.getBoundingClientRect().top + scrollY - innerHeight + d.offsetHeight * 0.5);
    });
    await wait(900);
    assert.equal((await stage(page)).stage, 4, "not started with the devices half in view and the steps unseen");
    // the devices and the first step in view: it plays
    await page.evaluate(() => {
      const li = document.querySelector("[data-go='1']").closest("li");
      scrollTo(0, li.getBoundingClientRect().bottom + scrollY - innerHeight + 24);
    });
    const geoNow = await page.evaluate(() => {
      const d = document.querySelector("[data-seq] .seq-devices").getBoundingClientRect();
      const nav = document.querySelector(".nav-in").getBoundingClientRect().bottom;
      return (Math.min(innerHeight, d.bottom) - Math.max(nav, d.top)) / d.height;
    });
    assert.ok(geoNow >= 0.6, `the devices are ${Math.round(geoNow * 100)} % in view below the nav`);
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

describe("Couch for Windows and the download link", { skip }, () => {
  const ISSUE = "https://github.com/abdullahnettoor/couch/issues/34";
  const DMG = "https://github.com/abdullahnettoor/couch/releases/latest/download/Couch-arm64.dmg";

  test("the Windows button is a plain link to issue #34, and following it is the only request the card makes", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    const away = [];
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (r.url().startsWith(url) || r.url().startsWith("data:")) { r.continue().catch(() => {}); return; }
      away.push({ url: r.url(), method: r.method(), type: r.resourceType() });
      r.abort().catch(() => {});
    });
    await page.goto(`${url}#windows`, { waitUntil: "load" });
    await wait(800);
    const card = await page.$eval("#windows", (c) => ({
      links: [...c.querySelectorAll("a")].map((a) => ({ href: a.href, rel: a.rel, target: a.target, text: a.textContent.trim() })),
      buttons: c.querySelectorAll("button").length,
      text: c.textContent.replace(/\s+/g, " ").trim(),
    }));
    assert.deepEqual(card.links, [{ href: ISSUE, rel: "noopener", target: "", text: "Couch for Windows on GitHub" }]);
    assert.equal(card.buttons, 0, "no counting button");
    assert.match(card.text, /being considered, not promised/);
    assert.match(card.text, /GitHub account/);
    assert.doesNotMatch(card.text, /Counted|did not go through|anonymous count/);
    assert.equal(await page.$("[data-demand]"), null, "no demand markup left");
    assert.deepEqual(away, [], "nothing leaves the local server before the click");
    await page.click("#windows a");
    await wait(500);
    assert.deepEqual(away.map((r) => [r.method, r.url, r.type]), [["GET", ISSUE, "document"]], "the click only navigates to the issue");
    await page.close();
  });

  test("nothing is stored, and both download links fetch the latest release's .dmg", async () => {
    const page = await open({ width: 1440, height: 900, reduce: true });
    const s = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      dl: [...document.querySelectorAll("a.sub")].filter((a) => /download free from GitHub/.test(a.textContent)).map((a) => a.href),
    }));
    assert.deepEqual(s.local, []);
    assert.deepEqual(s.dl, [DMG, DMG]);
    await page.close();
  });
});

describe("the Buy Me a Coffee link in the maker letter", { skip }, () => {
  const COFFEE = "https://buymeacoffee.com/abdullahnettoor";

  test("one plain link under the signature, new tab, safe rel, and loading it is not the page's business", async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    const away = [];
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (r.url().startsWith(url) || r.url().startsWith("data:")) { r.continue().catch(() => {}); return; }
      away.push(r.url());
      r.abort().catch(() => {});
    });
    await page.goto(url, { waitUntil: "load" });
    await wait(500);
    const s = await page.evaluate((href) => {
      const all = [...document.querySelectorAll("a")].filter((a) => a.href.includes("buymeacoffee"));
      const a = all[0];
      const sign = document.querySelector("#why .why-sign");
      return {
        count: all.length,
        inLetter: !!a?.closest("#why"),
        href: a?.href, rel: a?.rel, target: a?.target, text: a?.parentElement.textContent.replace(/\s+/g, " ").trim(),
        below: !!a && !!sign && !!(sign.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) && a.getBoundingClientRect().top >= sign.getBoundingClientRect().bottom - 1,
        embeds: document.querySelectorAll("iframe[src*=buymeacoffee], script[src*=buymeacoffee], img[src*=buymeacoffee], img[src*=bmc]").length,
      };
    }, COFFEE);
    assert.equal(s.count, 1, "only one such link on the page");
    assert.ok(s.inLetter, "it is in the letter");
    assert.equal(s.href, COFFEE);
    assert.equal(s.target, "_blank");
    assert.equal(s.rel, "noopener noreferrer");
    assert.match(s.text, /^Enjoying Couch\? Buy me a coffee/);
    assert.ok(s.below, "under the signature");
    assert.equal(s.embeds, 0);
    assert.deepEqual(away, [], "the link loads nothing");
    await page.close();
  });
});
