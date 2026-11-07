// Behavioural tests of the first look's live TV (ticket 145) in headless Chrome, on two builds: the placeholder
// (LAUNCH_VIDEO.id empty: YouTube opens to the poster) and a video (a fake id, COUCH_LAUNCH_ID, with a local fixture
// thumbnail, COUCH_LAUNCH_THUMB: YouTube opens to YouTube's player, cued). YouTube's and Google's hosts are
// unreachable in the browser (--host-resolver-rules), and every request to a host other than the local server is
// recorded: there must be none before YouTube is opened. The build never fetches either.
// Checks the pin (the TV stays whole below the nav across the track), the scroll-driven highlight (Continue →
// Library → Netflix → YouTube in even steps, and back; never opening anything) until the visitor uses the TV, the
// mouse (pointing moves the highlight, a click opens), the keys (the toolbar's one tab stop, ← → only with the focus
// in the TV, Enter and Space open, Esc and Home go back), each App's view, the hint (keys and mouse, or touch),
// reduced motion (no pin and no scroll-driven highlight, still usable) and no layout shift.
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
const FAKE_ID = "TESTvideo01";
const EMBED = `https://www.youtube-nocookie.com/embed/${FAKE_ID}?rel=0&playsinline=1`;
const BLOCKED = ["youtube.com", "youtube-nocookie.com", "ytimg.com", "googlevideo.com", "ggpht.com", "google.com", "gstatic.com", "googleapis.com", "doubleclick.net", "netflix.com", "nflxext.com", "nflximg.net"];
const isYouTube = (host) => BLOCKED.slice(0, 9).some((d) => host === d || host.endsWith(`.${d}`));
const KEY_HINT = "Use ← → or your mouse. Press Enter to open.";

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

const tmp = skip ? "" : mkdtempSync(join(tmpdir(), "couch-launch-"));
let browser;
const builds = {};
before(async () => {
  if (skip) return;
  for (const [name, env] of [["placeholder", { COUCH_LAUNCH_ID: "" }], ["video", { COUCH_LAUNCH_ID: FAKE_ID, COUCH_LAUNCH_THUMB: "scripts/fixtures/launch-thumb.webp" }]]) {
    const out = join(tmp, name);
    execFileSync(join(root, "node_modules/.bin/vite"), ["build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
    const server = await serve(out);
    builds[name] = { out, server, url: `http://127.0.0.1:${server.address().port}/` };
  }
  const rules = BLOCKED.flatMap((d) => [`MAP ${d} ~NOTFOUND`, `MAP *.${d} ~NOTFOUND`]).join(", ");
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: [`--host-resolver-rules=${rules}`] });
});
after(async () => {
  await browser?.close();
  Object.values(builds).forEach((b) => b.server.close());
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** A fresh tab on a build, recording every request that leaves the local server, and the layout shifts. */
async function open(build, { width = 1440, height = 900, reduce = false, touch = false } = {}) {
  const page = await browser.newPage();
  if (touch) await page.emulate({ viewport: { width, height, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  else await page.setViewport({ width, height });
  if (reduce) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.away = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1") page.away.push(r.url());
  });
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(builds[build].url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => { window.__cls = 0; }));
  await page.keyboard.press("Shift"); // skips the hero intro
  await page.waitForFunction(() => document.documentElement.classList.contains("intro-done") || !document.documentElement.classList.contains("intro"));
  return page;
}
/** Scrolls to `p` of the pin (0: the TV has just pinned, 1: about to be let go; outside 0–1 before or after it). */
const at = (page, p) => page.evaluate((p) => {
  const t = document.querySelector("[data-fl-track]"), pin = t.firstElementChild;
  let y = 0;
  for (let el = t; el; el = el.offsetParent) y += el.offsetTop;
  document.documentElement.style.scrollBehavior = "auto";
  scrollTo(0, y - parseFloat(getComputedStyle(pin).top || "0") + p * (t.offsetHeight - pin.offsetHeight));
}, p).then(() => wait(250));
/** Scrolls the TV to the middle of the window (reduced motion: no pin). */
const centre = (page) => page.evaluate(() => {
  const tv = document.querySelector(".first-look .tv");
  let y = 0;
  for (let el = tv; el; el = el.offsetParent) y += el.offsetTop;
  document.documentElement.style.scrollBehavior = "auto";
  scrollTo(0, y + tv.offsetHeight / 2 - innerHeight / 2);
}).then(() => wait(250));
const live = (page) => page.waitForFunction(() => document.querySelector("[data-launch]").dataset.step === "row", { timeout: 6000 });
/** The TV now. */
const lv = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-launch]");
  const r = el.closest(".tv").getBoundingClientRect();
  const on = [...el.querySelectorAll(".lv-view.on")].map((v) => v.dataset.view);
  const a = document.activeElement;
  return {
    step: el.dataset.step ?? "", focus: el.dataset.focus ?? "", highlighted: [...el.querySelectorAll(".h-app.focused")].map((t) => t.dataset.id).join(","),
    open: el.dataset.open ?? "", on: on.join(","), used: el.dataset.used != null, lit: el.classList.contains("lit"),
    hint: el.dataset.hint != null ? el.querySelector(".lv-hint").textContent : null,
    hintOpacity: Number(getComputedStyle(el.querySelector(".lv-hint")).opacity),
    frame: el.querySelector("iframe")?.src ?? null,
    active: a?.tagName === "IFRAME" ? "iframe" : a?.closest?.(".h-app")?.dataset.id ?? (a?.classList.contains("lv-back") ? "back" : a?.classList.contains("lv-libhome") ? "libhome" : a?.tagName ?? ""),
    veil: el.dataset.veil ?? null, veilOpacity: Number(getComputedStyle(el.querySelector(".lv-veil")).opacity),
    tv: { top: r.top, bottom: r.bottom, h: r.height }, cls: window.__cls,
  };
});
const tileCentre = (page, id) => page.$eval(`.h-app[data-id="${id}"] .lv-tile`, (b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

describe("the pinned TV and the scroll", { skip }, () => {
  test("it pins below the nav, whole, across the track, and is let go after it", async () => {
    const page = await open("video");
    await at(page, 0);
    await live(page);
    const tops = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      await at(page, p);
      const s = await lv(page);
      tops.push(Math.round(s.tv.top));
      assert.ok(s.tv.top >= 66 && s.tv.bottom <= 900, `at ${p}: the whole TV below the nav (${JSON.stringify(s.tv)})`);
    }
    assert.equal(new Set(tops).size, 1, `it stays put: ${tops}`);
    await at(page, 1.3);
    assert.ok((await lv(page)).tv.top < tops[0] - 50, "and goes on with the page after the track");
    const pinLen = await page.evaluate(() => { const t = document.querySelector("[data-fl-track]"); return (t.offsetHeight - t.firstElementChild.offsetHeight) / innerHeight; });
    assert.ok(pinLen > 1.5 && pinLen < 1.7, `the pin lasts about 1.6 windows (${pinLen})`);
    assert.equal((await lv(page)).cls, 0, "no layout shift");
    await page.close();
  });

  test("until it is used, the scroll moves the highlight Continue → Library → Netflix → YouTube in even steps, and back, and opens nothing", async () => {
    const page = await open("video");
    await at(page, 0);
    await live(page);
    await wait(4000); // the overlay's time and fade, then the hint's fade in
    let s = await lv(page);
    assert.equal(s.focus, "continue");
    assert.equal(s.lit, false, "on the Continue tile, Home shows its picture");
    assert.equal(s.hint, KEY_HINT);
    assert.equal(s.hintOpacity, 1);
    const seen = [];
    for (const p of [0.1, 0.2, 0.3, 0.45, 0.55, 0.7, 0.8, 0.95, 0.7, 0.45, 0.2, 0.05]) {
      await at(page, p);
      seen.push((await lv(page)).focus);
    }
    assert.deepEqual(seen, ["continue", "continue", "library", "library", "netflix", "netflix", "youtube", "youtube", "netflix", "library", "continue", "continue"]);
    await at(page, 0.9);
    s = await lv(page);
    assert.equal(s.focus, "youtube");
    assert.equal(s.highlighted, "youtube", "one highlight, Couch's .focused");
    assert.ok(s.lit, "off the Continue tile: the wallpaper and the clock");
    assert.equal(s.hint, "Press Enter or click to watch the launch video.");
    assert.equal(s.open, "", "the scroll never opens anything");
    assert.equal(s.frame, null);
    assert.deepEqual(page.away, []);
    assert.equal(s.cls, 0);
    await page.close();
  });

  test("once the visitor points at a tile, the scroll no longer moves the highlight, and the hint goes", async () => {
    const page = await open("video");
    await at(page, 0.05);
    await live(page);
    const c = await tileCentre(page, "netflix");
    await page.mouse.move(c.x - 30, c.y);
    await page.mouse.move(c.x, c.y, { steps: 4 });
    await wait(100);
    let s = await lv(page);
    assert.equal(s.focus, "netflix", "pointing moves the highlight");
    assert.ok(s.used);
    assert.equal(s.hint, null);
    await wait(600);
    assert.equal((await lv(page)).hintOpacity, 0, "the hint has faded");
    for (const p of [0.9, 0.3]) {
      await at(page, p);
      s = await lv(page);
      assert.equal(s.focus, "netflix", `the scroll leaves it (${p})`);
    }
    await page.close();
  });

  test("a tile sliding under a still pointer as the page scrolls is not the visitor's doing", async () => {
    const page = await open("video");
    await page.mouse.move(720, 700);
    await at(page, 0.3);
    await live(page);
    await at(page, 0.35);
    const s = await lv(page);
    assert.equal(s.used, false);
    assert.equal(s.focus, "library");
    await page.close();
  });
});

describe("the overlay: how to use the TV, each time it comes into place until it is used", { skip }, () => {
  /** Scrolls to before the pin, waits for the live Home, then into the pin. */
  const pinIn = async (page, p = 0.02) => { await at(page, -0.4); await live(page); await at(page, p); };

  test("it covers the Screen as the TV pins, stays about 2.5 s, then fades (.7 s); hidden from screen readers, and it takes no pointer", async () => {
    const page = await open("video");
    await at(page, -0.4);
    await live(page);
    await wait(300);
    assert.equal((await lv(page)).veil, null, "not before the TV is in place");
    await at(page, 0.02);
    let s = await lv(page);
    assert.equal(s.veil, "on");
    const v = await page.evaluate(() => {
      const veil = document.querySelector(".lv-veil"), sc = document.querySelector(".tv-screen").getBoundingClientRect(), r = veil.getBoundingClientRect();
      const shown = (sel) => getComputedStyle(veil.querySelector(sel)).display !== "none";
      return { hidden: veil.getAttribute("aria-hidden"), pe: getComputedStyle(veil).pointerEvents, covers: Math.abs(r.width - (sc.width - 18)) < 2 && Math.abs(r.height - (sc.height - 18)) < 2,
        text: [...veil.querySelectorAll(".lv-veil-key p")].map((p) => p.textContent), keys: [...veil.querySelectorAll(".lv-key")].map((k) => k.textContent).join(""), key: shown(".lv-veil-key"), touch: shown(".lv-veil-touch") };
    });
    assert.deepEqual(v, { hidden: "true", pe: "none", covers: true, text: ["Use the arrow keys or your mouse", "Enter or click opens a tile"], keys: "←→", key: true, touch: false });
    await wait(500);
    assert.equal((await lv(page)).veilOpacity, 1);
    await wait(1700);
    assert.equal((await lv(page)).veil, "on", "still there at about 2.2 s");
    await wait(600);
    s = await lv(page);
    assert.equal(s.veil, "fade", "fading after 2.5 s");
    assert.ok(s.veilOpacity < 1 && s.veilOpacity > 0, `mid-fade ${s.veilOpacity}`);
    await wait(800);
    s = await lv(page);
    assert.equal(s.veil, null);
    assert.equal(s.veilOpacity, 0);
    assert.equal(s.cls, 0);
    await page.close();
  });

  test("without a use, it comes back each time the TV pins again (from above and from below); scrolling on past the pin takes it away at once", async () => {
    const page = await open("video");
    await pinIn(page);
    assert.equal((await lv(page)).veil, "on");
    await at(page, 1.3);
    assert.equal((await lv(page)).veil, null, "gone at once past the pin");
    await at(page, 0.9);
    assert.equal((await lv(page)).veil, "on", "back, pinned again from below");
    await at(page, 0.5);
    assert.equal((await lv(page)).veil, "on", "a scroll inside the pin doesn't restart it");
    await at(page, -0.4);
    assert.equal((await lv(page)).veil, null);
    await at(page, 0.1);
    assert.equal((await lv(page)).veil, "on", "back, pinned again from above");
    assert.equal((await lv(page)).used, false);
    await page.close();
  });

  test("a pointer moving over the Screen takes it away at once, and after that it never comes back", async () => {
    const page = await open("video");
    await pinIn(page);
    const c = await page.$eval(".lv-home .h-clock", (e) => { const b = e.getBoundingClientRect(); return { x: b.x + 20, y: b.y + 20 }; });
    await page.mouse.move(c.x, c.y);
    await page.mouse.move(c.x + 30, c.y + 5, { steps: 3 });
    let s = await lv(page);
    assert.equal(s.veil, null);
    assert.equal(s.veilOpacity, 0, "at once, no fade");
    for (const p of [1.3, 0.5, -0.4, 0.1]) {
      await at(page, p);
      assert.equal((await lv(page)).veil, null, `not again (${p})`);
    }
    await page.close();
  });

  test("the first click both takes it away and opens the tile under it", async () => {
    const page = await open("video");
    await pinIn(page);
    const c = await tileCentre(page, "library");
    await page.mouse.click(c.x, c.y);
    await page.waitForFunction(() => document.querySelector("[data-launch]").dataset.open === "library", { timeout: 2000 });
    assert.equal((await lv(page)).veil, null);
    await page.close();
  });

  test("a key in the TV takes it away", async () => {
    const page = await open("video");
    await pinIn(page);
    await page.evaluate(() => document.querySelector(".h-app[data-id=continue] .lv-tile").focus({ preventScroll: true }));
    await page.keyboard.press("ArrowLeft");
    const s = await lv(page);
    assert.equal(s.veil, null);
    assert.equal(s.focus, "library", "and the key does its job");
    await page.close();
  });

  test("touch: a tap glyph and \"Tap a tile to open it\"", async () => {
    const page = await open("video", { width: 390, height: 844, touch: true });
    await pinIn(page);
    assert.equal((await lv(page)).veil, "on");
    const v = await page.evaluate(() => {
      const veil = document.querySelector(".lv-veil");
      return { key: getComputedStyle(veil.querySelector(".lv-veil-key")).display, touch: getComputedStyle(veil.querySelector(".lv-veil-touch")).display, text: veil.querySelector(".lv-veil-touch p").textContent, glyph: !!veil.querySelector(".lv-veil-touch svg") };
    });
    assert.deepEqual(v, { key: "none", touch: "grid", text: "Tap a tile to open it", glyph: true });
    const c = await tileCentre(page, "netflix");
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForFunction(() => document.querySelector("[data-launch]").dataset.open === "netflix", { timeout: 2000 });
    assert.equal((await lv(page)).veil, null);
    await page.close();
  });

  test("reduced motion: it shows (no fade in) once the TV is 60% in view, the same rules", async () => {
    const page = await open("video", { reduce: true });
    await page.evaluate(() => { const tv = document.querySelector(".first-look .tv"); let y = 0; for (let el = tv; el; el = el.offsetParent) y += el.offsetTop; document.documentElement.style.scrollBehavior = "auto"; scrollTo(0, y - innerHeight + tv.offsetHeight * 0.3); });
    await wait(300);
    assert.equal((await lv(page)).veil, null, "not at 30% in view");
    await centre(page);
    await live(page);
    await wait(50);
    let s = await lv(page);
    assert.equal(s.veil, "on");
    assert.equal(s.veilOpacity, 1, "at once");
    await wait(2700);
    s = await lv(page);
    assert.ok(s.veil === "fade" || s.veil === null);
    assert.equal(s.veilOpacity, 0, "and gone at once");
    await page.evaluate(() => scrollTo(0, 0));
    await wait(300);
    await centre(page);
    assert.equal((await lv(page)).veil, "on", "again, next time it comes into view");
    const c = await tileCentre(page, "youtube");
    await page.mouse.move(c.x, c.y);
    await page.mouse.move(c.x + 20, c.y, { steps: 2 });
    assert.equal((await lv(page)).veil, null);
    await page.close();
  });
});

describe("using the TV", { skip }, () => {
  test("keys: one tab stop, ← → only while the focus is in the TV, and a click into the TV puts the keys there", async () => {
    const page = await open("video");
    await at(page, 0.05);
    await live(page);
    // the focus elsewhere: the arrows are the page's, not the TV's
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("ArrowLeft");
    await wait(100);
    assert.equal((await lv(page)).focus, "continue", "← with the focus outside does nothing to the TV");
    // Tab from just before the TV lands on the highlighted tile (the toolbar's single tab stop)
    await page.evaluate(() => { const a = document.createElement("a"); a.href = "#"; a.id = "before-tv"; document.querySelector(".first-look").prepend(a); a.focus({ preventScroll: true }); });
    await page.keyboard.press("Tab");
    let s = await lv(page);
    assert.equal(s.active, "continue");
    assert.equal(await page.evaluate(() => [...document.querySelectorAll(".lv-tile")].filter((b) => b.tabIndex === 0).length), 1, "roving tabindex");
    await page.keyboard.press("ArrowLeft");
    s = await lv(page);
    assert.equal(s.focus, "library");
    assert.equal(s.active, "library", "the focus goes with the highlight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    assert.equal((await lv(page)).focus, "youtube", "it stops at the end of the row");
    await page.keyboard.press("End");
    assert.equal((await lv(page)).focus, "continue");
    await page.keyboard.press("Home");
    assert.equal((await lv(page)).focus, "youtube");
    // focus out, then a click on the TV (off the tiles) puts the keys back in it
    await page.evaluate(() => document.getElementById("before-tv").focus({ preventScroll: true }));
    const r = await page.$eval(".lv-home .h-clock", (e) => { const b = e.getBoundingClientRect(); return { x: b.x + 10, y: b.y + 10 }; });
    await page.mouse.click(r.x, r.y);
    s = await lv(page);
    assert.equal(s.active, "youtube", "a click into the TV focuses it");
    assert.equal(s.open, "");
    await page.keyboard.press("ArrowRight");
    assert.equal((await lv(page)).focus, "netflix");
    assert.equal(await page.$eval(".lv-home .h-row", (e) => `${e.getAttribute("role")}|${e.getAttribute("aria-label")}`), "toolbar|Couch Home");
    assert.equal(await page.$eval("[data-launch]", (e) => `${e.getAttribute("role")}|${e.getAttribute("aria-roledescription")}|${e.getAttribute("aria-label")}`), "group|TV|Couch on the Screen");
    assert.deepEqual(page.away, []);
    await page.close();
  });

  for (const key of ["Enter", "Space"]) {
    test(`YouTube opens the launch video's player, cued (no autoplay), by ${key}; nothing from YouTube before; Home and Esc go back`, async () => {
      const page = await open("video");
      await at(page, 0.9);
      await live(page);
      await page.waitForFunction(() => document.querySelector("[data-launch]").dataset.focus === "youtube");
      await page.evaluate(() => document.querySelector(".h-app[data-id=youtube] .lv-tile").focus({ preventScroll: true }));
      await wait(300);
      assert.deepEqual(page.away, [], "nothing from YouTube before it is opened");
      assert.equal(await page.evaluate(() => document.body.innerHTML.includes("youtube-nocookie.com/embed/") && !document.querySelector("iframe")), true, "the player's address is only data until then");
      await page.keyboard.press(key);
      await page.waitForSelector("[data-launch] iframe");
      await page.waitForFunction(() => document.activeElement?.tagName === "IFRAME", { timeout: 3000 });
      const fr = await page.$eval("[data-launch] iframe", (e) => ({ src: e.src, title: e.title, allow: e.allow, fs: e.allowFullscreen, referrer: e.getAttribute("referrerpolicy"), w: e.offsetWidth, sw: e.closest(".lv").offsetWidth }));
      assert.equal(fr.src, EMBED, "YouTube's privacy-enhanced player, cued: the visitor's own press on its play counts as a view");
      assert.ok(!/autoplay|enablejsapi/.test(new URL(fr.src).search));
      assert.equal(fr.title, `${await page.$eval("[data-launch]", (e) => e.dataset.title)} (YouTube video)`);
      for (const a of ["encrypted-media", "picture-in-picture"]) assert.ok(fr.allow.includes(a), `allow ${a}`);
      assert.ok(fr.fs);
      assert.equal(fr.referrer, "strict-origin-when-cross-origin");
      assert.equal(fr.w, fr.sw, "it fills the Screen");
      let s = await lv(page);
      assert.equal(s.open, "youtube");
      assert.equal(s.on, "youtube");
      await wait(300);
      assert.ok(page.away.some((u) => u.startsWith(EMBED)), "only now YouTube is asked (and refused here)");
      assert.ok(page.away.every((u) => isYouTube(new URL(u).hostname)), page.away.join(" "));
      // Home goes back, the player with it, and the highlight and the focus are on YouTube again
      await page.click(".lv-back");
      await wait(100);
      s = await lv(page);
      assert.equal(s.open, "");
      assert.equal(s.frame, null, "the player is gone");
      assert.equal(s.active, "youtube");
      // and Esc (from the TV; inside YouTube's player the keys are YouTube's)
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-launch] iframe");
      await page.focus(".lv-back");
      await page.keyboard.press("Escape");
      await wait(100);
      s = await lv(page);
      assert.equal(s.open, "");
      assert.equal(s.frame, null);
      assert.equal(s.active, "youtube");
      assert.equal(s.cls, 0);
      await page.close();
    });
  }

  test("Library, Netflix and Continue open their glimpses (by click), each with Home; nothing leaves the site", async () => {
    const page = await open("video");
    await at(page, 0.05);
    await live(page);
    for (const [id, check] of [
      ["library", (v) => v.img && v.img.local && v.img.loaded && /Library/.test(v.img.alt)],
      ["netflix", (v) => v.text === "Netflix opens Netflix's own website, signed in with your account."],
      ["continue", (v) => v.img && v.img.local && v.img.loaded && /player/.test(v.img.alt)],
    ]) {
      await page.click(`.h-app[data-id="${id}"] .lv-tile`);
      await page.waitForFunction((id) => document.querySelector(`.lv-view[data-view="${id}"]`).classList.contains("on"), { timeout: 3000 }, id);
      await wait(600);
      const v = await page.$eval(`.lv-view[data-view="${id}"]`, (e) => {
        const img = e.querySelector("img");
        return { opacity: getComputedStyle(e).opacity, text: e.querySelector("p")?.textContent ?? "",
          img: img && { local: new URL(img.currentSrc || img.src).host === location.host, loaded: img.complete && img.naturalWidth > 0, alt: img.alt } };
      });
      assert.equal(v.opacity, "1", id);
      assert.ok(check(v), `${id}: ${JSON.stringify(v)}`);
      const s = await lv(page);
      assert.equal(s.open, id);
      assert.equal(s.active, id === "library" ? "libhome" : "back", "the focus is on Home");
      if (id === "library") {
        // one Home: the screenshot's own "‹ Home" (an invisible button over it), no pill
        const h = await page.evaluate(() => {
          const b = document.querySelector(".lv-libhome").getBoundingClientRect(), sc = document.querySelector("[data-launch]").getBoundingClientRect();
          return { pill: getComputedStyle(document.querySelector(".lv-back")).display, label: document.activeElement.getAttribute("aria-label"),
            x: (b.left - sc.left) / sc.width, y: (b.top - sc.top) / sc.height, w: b.width / sc.width, opacity: getComputedStyle(document.querySelector(".lv-libhome")).backgroundColor };
        });
        assert.equal(h.pill, "none", "no Home pill over the Library");
        assert.equal(h.label, "Home");
        assert.ok(h.x > 0.03 && h.x < 0.05 && h.y < 0.02 && h.w > 0.05 && h.w < 0.08, `over the screenshot's "‹ Home": ${JSON.stringify(h)}`);
        await page.keyboard.press("Escape");
        await wait(100);
        const e = await lv(page);
        assert.equal(e.open, "", "Esc goes back from the Library too");
        assert.equal(e.active, "library");
        continue;
      }
      await page.keyboard.press("Enter"); // Home
      await wait(100);
      const b = await lv(page);
      assert.equal(b.open, "");
      assert.equal(b.active, id);
    }
    assert.deepEqual(page.away, [], "no request left the site");
    assert.equal((await lv(page)).cls, 0);
    await page.close();
  });

  test("the placeholder: YouTube opens the poster, and nothing on the page names YouTube's servers", async () => {
    const html = readFileSync(join(builds.placeholder.out, "index.html"), "utf8");
    assert.ok(!/youtube-nocookie|ytimg|\/embed\//.test(html), "no player and no thumbnail from YouTube");
    assert.ok(!/lv-under|Subscribe on YouTube|Watch on YouTube/.test(html), "no links or note under the TV");
    const page = await open("placeholder");
    await at(page, 0.9);
    await live(page);
    assert.equal((await lv(page)).hint, "Press Enter or click to open YouTube.");
    await page.click(".h-app[data-id=youtube] .lv-tile");
    await page.waitForFunction(() => document.querySelector(".lv-view[data-view=youtube]").classList.contains("on"));
    await wait(1000);
    assert.equal(await page.$eval(".lv-poster .lv-text", (e) => e.innerText.replace(/\s+/g, " ").trim()), "Launch video Coming soon to YouTube");
    assert.equal(await page.$("iframe"), null);
    assert.deepEqual(page.away, []);
    assert.equal(await page.$eval("#privacy .facts li:nth-child(3) span", (e) => e.textContent), "This site uses no cookies or analytics. Services opened in Couch have their own sign-ins, cookies and privacy policies.");
    await page.close();
  });

  test("the privacy lines with a video, and no links or note under the TV", async () => {
    const page = await open("video");
    assert.equal(await page.$eval("#privacy .facts li:nth-child(3) span", (e) => e.textContent),
      "Couch adds no analytics or cookies. YouTube loads only when you open YouTube on the TV above, and may use cookies or browser storage under Google's privacy policy. Services opened in Couch have their own sign-ins, cookies and privacy policies.");
    assert.match(await page.$eval("#year", (e) => e.parentElement.textContent), /Abdullah Nettoor\. No cookies or analytics from Couch\.$/);
    assert.equal(await page.$(".lv-under, .lv-links, .lv-note, video"), null);
    await page.close();
  });

  test("touch: the hint says tap, and a tap opens", async () => {
    const page = await open("video", { width: 390, height: 844, touch: true });
    assert.ok(await page.evaluate(() => matchMedia("(hover: none), (pointer: coarse)").matches), "a coarse pointer");
    await at(page, 0.05);
    await live(page);
    assert.equal((await lv(page)).hint, "Tap a tile.");
    await at(page, 0.9);
    assert.equal((await lv(page)).hint, "Tap YouTube to watch the launch video.");
    const s0 = await lv(page);
    assert.ok(s0.tv.top >= 66 && s0.tv.bottom <= 844, "pinned whole on a phone too");
    const c = await tileCentre(page, "library");
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForFunction(() => document.querySelector("[data-launch]").dataset.open === "library", { timeout: 2000 });
    await page.close();
  });

  test("reduced motion: no pin, no scroll-driven highlight, no growth; the TV still works, at once", async () => {
    const page = await open("video", { reduce: true });
    const pin = await page.evaluate(() => { const t = document.querySelector("[data-fl-track]"); return { pos: getComputedStyle(t.firstElementChild).position, extra: t.offsetHeight - t.firstElementChild.offsetHeight, scale: getComputedStyle(document.querySelector(".first-look .tv")).scale }; });
    assert.equal(pin.pos, "static");
    assert.equal(pin.extra, 0, "no extra scroll");
    assert.ok(pin.scale === "none" || pin.scale === "1", pin.scale);
    await centre(page);
    await live(page);
    for (const dy of [200, 400, -300]) {
      await page.evaluate((dy) => scrollBy(0, dy), dy);
      await wait(200);
      assert.equal((await lv(page)).focus, "continue", "the scroll moves nothing");
    }
    await centre(page);
    const c = await tileCentre(page, "library");
    await page.mouse.move(c.x - 20, c.y);
    await page.mouse.move(c.x, c.y, { steps: 3 });
    assert.equal((await lv(page)).focus, "library", "pointing still moves it");
    await page.click(".h-app[data-id=library] .lv-tile");
    const s = await lv(page);
    assert.equal(s.open, "library");
    assert.equal(s.on, "library", "open at once");
    assert.equal(await page.evaluate(() => document.querySelector("[data-launch]").getAnimations({ subtree: true }).filter((a) => a.playState === "running").length), 0, "nothing moves");
    await page.keyboard.press("Escape");
    assert.equal((await lv(page)).open, "");
    await page.close();
  });

  test("before it comes to life the live Home is hidden and inert (no-JS and early visitors see the screenshot)", async () => {
    const html = readFileSync(join(builds.video.out, "index.html"), "utf8");
    assert.match(html, /<div class="cu lv-home" aria-hidden="true" inert>/);
    assert.match(html, /<script>document\.documentElement\.classList\.add\("js"\)<\/script>/);
  });
});
