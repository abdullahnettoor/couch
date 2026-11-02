// Behavioural tests of the launch video in the first-look TV (ticket 145) in headless Chrome, on two builds: the
// placeholder (LAUNCH_VIDEO.id empty: the poster and Subscribe) and a video (a fake id, COUCH_LAUNCH_ID, with a local
// fixture thumbnail, COUCH_LAUNCH_THUMB: the thumbnail, a click-to-load play button, Watch and Subscribe).
// YouTube's and Google's hosts are unreachable in the browser (--host-resolver-rules), and every request to a host
// other than the local server is recorded: there must be none before play is pressed. The build never fetches either.
// Checks the sequence (Home → YouTube pressed → open → end, once, at 60 % in view, after the intro, no layout shift),
// reduced motion (the end state at once, and a switch to it mid-sequence), and the play button by mouse, Enter and Space.
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
const CHANNEL = "https://www.youtube.com/@abdullahnettoor";
const BLOCKED = ["youtube.com", "youtube-nocookie.com", "ytimg.com", "googlevideo.com", "ggpht.com", "google.com", "gstatic.com", "googleapis.com", "doubleclick.net"];
const isYouTube = (host) => BLOCKED.some((d) => host === d || host.endsWith(`.${d}`));

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
async function open(build, { width = 1280, height = 860, reduce = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
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
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const skipIntro = async (page) => {
  await page.keyboard.press("Shift");
  await page.waitForFunction(() => document.documentElement.classList.contains("intro-done") || !document.documentElement.classList.contains("intro"));
};
/** Scrolls so that `share` of the first-look TV is in view (1: its middle at the window's middle). */
const showTv = (page, share = 1) => page.evaluate((share) => {
  const r = document.querySelector("[data-launch]").closest(".tv").getBoundingClientRect();
  const top = share >= 1 ? scrollY + r.top + r.height / 2 - innerHeight / 2 : scrollY + r.top - innerHeight + r.height * share;
  scrollTo({ top, behavior: "instant" });
}, share);
/** The launch video now. */
const lv = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-launch]");
  const op = (s) => { const e = el.querySelector(s); return e ? Number(getComputedStyle(e).opacity) : null; };
  return {
    state: el.dataset.state, step: el.dataset.step ?? "", lit: el.classList.contains("lit"),
    focus: [...el.querySelectorAll(".lv-home .h-app.focused")].map((t) => t.dataset.id).join(","),
    pressed: !!el.querySelector(".lv-pressed"),
    end: op(".lv-end"), endVisible: getComputedStyle(el.querySelector(".lv-end")).visibility,
    frame: !!el.querySelector("iframe"), cls: window.__cls,
  };
});
const waitState = (page, s, timeout = 8000) => page.waitForFunction((s) => document.querySelector("[data-launch]").dataset.state === s, { timeout }, s);

describe("placeholder (no video id)", { skip }, () => {
  test("the built page names no YouTube server but the links, and has no player", () => {
    const html = readFileSync(join(builds.placeholder.out, "index.html"), "utf8");
    assert.ok(!/youtube-nocookie|ytimg|\/embed\//.test(html), "no player and no thumbnail from YouTube");
    assert.equal(html.match(/data-mode="placeholder"/g)?.length, 1);
    assert.ok(!html.includes("lv-play"), "no play button");
    assert.ok(html.includes(">Licence (GPL-3.0)</a>"), "the footer's licence link");
    assert.ok(!html.includes(">GPL-3.0-or-later</a>"));
  });

  test("Home → the highlight moves left to YouTube → pressed → it opens → the poster; once, with no layout shift and nothing from YouTube", async () => {
    const page = await open("placeholder");
    await skipIntro(page);
    assert.equal((await lv(page)).state, "waiting", "nothing plays out of view");
    await showTv(page);
    const seen = [];
    const t0 = Date.now();
    for (;;) {
      const s = await lv(page);
      const key = `${s.step}|${s.focus}|${s.pressed ? "pressed" : ""}`;
      if (key !== seen.at(-1)?.key) seen.push({ ...s, key, t: Date.now() - t0 });
      if (s.state === "ended" || Date.now() - t0 > 9000) break;
      await wait(20);
    }
    const focusOrder = seen.map((s) => s.focus).filter((f, i, a) => f && f !== a[i - 1]);
    assert.deepEqual(focusOrder, ["continue", "library", "netflix", "youtube"], JSON.stringify(seen.map((s) => s.key)));
    const steps = seen.map((s) => s.step).filter((f, i, a) => f !== a[i - 1]);
    assert.deepEqual(steps.slice(steps.indexOf("row")), ["row", "open", "end"], "row → open → end");
    const pressed = seen.find((s) => s.pressed);
    assert.ok(pressed && pressed.focus === "youtube" && pressed.step === "row", "YouTube is pressed before it opens");
    await wait(900);
    const end = await lv(page);
    assert.equal(end.step, "end");
    assert.equal(end.end, 1, "the poster is fully up");
    const poster = await page.evaluate(() => document.querySelector(".lv-poster .lv-text").innerText.replace(/\s+/g, " ").trim());
    assert.equal(poster, "Launch video Coming soon to YouTube");
    assert.equal(end.cls, 0, `no layout shift (${end.cls})`);
    // once: away and back, it stays at the end
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await wait(300);
    await showTv(page);
    await wait(500);
    const again = await lv(page);
    assert.equal(again.state, "ended");
    assert.equal(again.step, "end");
    assert.deepEqual(page.away, [], "no request left the site");
    await page.close();
  });

  test("it waits until the TV is mostly in view, and until the intro is done", async () => {
    // a window tall enough to hold the TV from the start (a scroll would skip the intro)
    let page = await open("placeholder", { width: 1280, height: 2000 });
    await wait(1200);
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains("intro") && !document.documentElement.classList.contains("intro-done")), "the intro is still playing");
    assert.equal((await lv(page)).state, "waiting", "not during the intro");
    await waitState(page, "playing", 6000);
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains("intro-done")), "once the intro is done");
    await page.close();

    page = await open("placeholder");
    await skipIntro(page);
    await showTv(page, 0.35);
    await wait(700);
    assert.equal((await lv(page)).state, "waiting", "not at a third in view");
    await showTv(page, 0.7);
    await waitState(page, "playing", 2000);
    await page.close();
  });

  test("Subscribe on YouTube under the TV: the channel, rel=noopener; no Watch link and no privacy line without a video", async () => {
    const page = await open("placeholder");
    const links = await page.$$eval(".lv-under a", (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.href, rel: a.rel })));
    assert.deepEqual(links, [{ text: "Subscribe on YouTube", href: CHANNEL, rel: "noopener" }]);
    assert.equal(await page.$(".lv-note"), null);
    const fact = await page.$eval("#privacy .facts li:nth-child(3) span", (e) => e.textContent);
    assert.equal(fact, "This site uses no cookies or analytics. Services opened in Couch have their own sign-ins, cookies and privacy policies.");
    await page.close();
  });

  test("reduced motion: the end state at once, before the TV is seen; and a switch to it mid-sequence ends it", async () => {
    let page = await open("placeholder", { reduce: true });
    let s = await lv(page);
    assert.equal(s.state, "ended");
    assert.equal(s.step, "end");
    assert.equal(s.focus, "youtube");
    assert.equal(s.end, 1);
    assert.equal(s.endVisible, "visible");
    assert.equal(await page.evaluate(() => document.querySelector("[data-launch]").getAnimations({ subtree: true }).filter((a) => a.playState === "running").length), 0, "nothing moves");
    await page.close();

    page = await open("placeholder");
    await skipIntro(page);
    await showTv(page);
    await page.waitForFunction(() => document.querySelector("[data-launch] .h-app.focused")?.dataset.id === "netflix", { timeout: 4000 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await waitState(page, "ended", 500);
    await wait(100); // a frame or two: the end's fade is .01ms under reduced motion
    s = await lv(page);
    assert.equal(s.state, "ended");
    assert.equal(s.step, "end");
    assert.equal(s.focus, "youtube");
    assert.equal(s.end, 1, "at once");
    assert.equal(await page.evaluate(() => document.querySelector(".lv-open").getAnimations().length), 0, "no opening left running");
    await page.close();
  });
});

describe("with a video (a fake id and a local thumbnail)", { skip }, () => {
  test("the facade: the local thumbnail, Watch and Subscribe, the privacy lines; nothing from YouTube until play is pressed", async () => {
    const page = await open("video");
    await skipIntro(page);
    await showTv(page);
    await waitState(page, "ended");
    await wait(300);
    const f = await page.evaluate(() => {
      const img = document.querySelector(".lv-facade .lv-thumb");
      return { src: new URL(img.currentSrc || img.src).host === location.host, loaded: img.complete && img.naturalWidth > 0, frames: document.querySelectorAll("iframe").length,
        title: document.querySelector(".lv-facade .lv-title").textContent, label: document.querySelector(".lv-play").getAttribute("aria-label") };
    });
    assert.ok(f.src && f.loaded, "the thumbnail is the site's own file, loaded");
    assert.equal(f.frames, 0, "no player yet");
    assert.match(f.label, /^Play the launch video: /);
    assert.equal(f.label, `Play the launch video: ${f.title}`);
    const links = await page.$$eval(".lv-under a", (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.href, rel: a.rel })));
    assert.deepEqual(links, [
      { text: "Watch on YouTube", href: `https://www.youtube.com/watch?v=${FAKE_ID}`, rel: "noopener" },
      { text: "Subscribe", href: CHANNEL, rel: "noopener" },
    ]);
    assert.equal(await page.$eval(".lv-note", (e) => e.textContent), "The launch video plays from YouTube and loads only when you press play.");
    assert.match(await page.$eval("#privacy .facts li:nth-child(3) span", (e) => e.textContent), /loads nothing from YouTube until you press play on the launch video/);
    assert.equal((await lv(page)).cls, 0, "no layout shift");
    await page.hover(".lv-under a"); // hovering a link fetches nothing either
    await wait(600);
    assert.deepEqual(page.away, [], "no request left the site before play");

    await page.click(".lv-play");
    await page.waitForSelector("[data-launch] iframe");
    const fr = await page.$eval("[data-launch] iframe", (e) => ({ src: e.src, title: e.title, allow: e.allow, fs: e.allowFullscreen, focused: document.activeElement === e, w: e.offsetWidth, sw: e.parentElement.offsetWidth }));
    assert.equal(fr.src, `https://www.youtube-nocookie.com/embed/${FAKE_ID}?autoplay=1&rel=0&playsinline=1`);
    assert.match(fr.title, /\(YouTube video\)$/);
    for (const a of ["autoplay", "encrypted-media", "picture-in-picture"]) assert.ok(fr.allow.includes(a), `allow ${a}`);
    assert.ok(fr.fs, "fullscreen allowed");
    assert.ok(fr.focused, "the player has the focus");
    assert.equal(fr.w, fr.sw, "it fills the Screen");
    await wait(300);
    assert.ok(page.away.some((u) => u.startsWith(`https://www.youtube-nocookie.com/embed/${FAKE_ID}`)), "only now YouTube is asked (and refused here)");
    assert.ok(page.away.every((u) => isYouTube(new URL(u).hostname)), page.away.join(" "));
    await page.close();
  });

  for (const key of ["Enter", "Space"]) {
    test(`the play button by keyboard (${key})`, async () => {
      const page = await open("video");
      await skipIntro(page);
      await showTv(page);
      await waitState(page, "ended");
      // Tab from the element before it reaches the play button (it is the first focusable thing in the TV)
      await page.evaluate(() => { const a = document.createElement("a"); a.href = "#"; a.id = "before-tv"; document.querySelector(".first-look").prepend(a); a.focus(); });
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.className), "lv-play");
      assert.equal(await page.$("[data-launch] iframe"), null);
      assert.deepEqual(page.away, []);
      await page.keyboard.press(key);
      await page.waitForSelector("[data-launch] iframe", { timeout: 2000 });
      await page.close();
    });
  }

  test("reduced motion: the thumbnail and the play button at once, and play works", async () => {
    const page = await open("video", { reduce: true });
    const s = await lv(page);
    assert.equal(s.state, "ended");
    assert.equal(s.end, 1);
    await showTv(page);
    await page.click(".lv-play");
    await page.waitForSelector("[data-launch] iframe");
    await page.close();
  });

  test("before the end the play button is out of reach (hidden, so neither Tab nor a screen reader finds it)", async () => {
    const page = await open("video");
    const vis = await page.$eval(".lv-play", (b) => [getComputedStyle(b).visibility, b.closest(".lv-end").inert, b.closest("[data-launch]").dataset.state].join());
    assert.equal(vis, "hidden,true,waiting");
    await page.close();
  });
});
