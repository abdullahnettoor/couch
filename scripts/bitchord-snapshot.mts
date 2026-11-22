// Records BitChord's live pages as page snapshots (the test fixtures in src/main/apps/bitchord/fixtures), by hand:
//   pnpm bitchord:snapshot [outDir]
// Signed out, muted, offscreen (a window that is never shown), on a temp userData. It also saves a frame of each page with
// Couch's real focus ring when BITCHORD_FRAMES=<dir> is set (1920×1080). Not in CI: it hits the live site.
import { app, BrowserWindow, session, webContents } from "electron";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bridgeNetwork } from "../src/main/apps/bitchord/bitchord-network.ts";
import { bitchordSite } from "../src/main/apps/bitchord/bitchord-route.ts";
import { BITCHORD_PARTITION, bitchordDescription } from "../src/main/apps/bitchord/bitchord-web.ts";
import { ElectronWebApp } from "../src/main/web/electron-web-app.ts";
import { hiddenWindow } from "./lib/hidden-window.mts";

const userData = mkdtempSync(join(tmpdir(), "couch-bitchord-snap-"));
app.setPath("userData", userData);
app.commandLine.appendSwitch("mute-audio");
app.dock?.hide();

const SITE = bitchordSite(process.env);
const OUT = resolve(
  process.argv.find((a, i) => i > 1 && !a.startsWith("-") && !a.endsWith(".mts")) ??
    "src/main/apps/bitchord/fixtures",
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log("[bitchord-snapshot]", ...a);

const WALK = `(function () {
  // What the focus tests read: the rest of a page's attributes, and all but its song-row classes, only add size.
  var KEEP = ["href","role","tabindex","aria-label","aria-modal","aria-hidden","aria-disabled","aria-checked","aria-pressed","aria-haspopup","type","placeholder","disabled"];
  // A list keeps its first rows or cards; the focus tests walk a few and a snapshot of a whole playlist is a megabyte.
  var CAP = 12;
  var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,LINK:1,META:1,HEAD:1,TITLE:1,PATH:1,CIRCLE:1,RECT:1,LINE:1,POLYLINE:1,POLYGON:1,G:1,DEFS:1,SVG:1,IMG:1,PICTURE:1,SOURCE:1};
  var n = 0;
  function walk(el) {
    if (SKIP[el.tagName.toUpperCase()] || n > 6000) return null;
    // Couch's own ring and pointer shield are not the page.
    if (el.style && (el.style.zIndex === "2147483647" || el.style.zIndex === "2147483646")) return null;
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var a = {};
    KEEP.forEach(function (k) { var v = el.getAttribute(k); if (v !== null) a[k] = v.slice(0, 200); });
    var rows = String(el.getAttribute("class") || "").split(/s+/).filter(function (c) { return c.indexOf("group/track") === 0 || c.indexOf("group/row") === 0; });
    if (rows.length) a["class"] = rows.join(" ");
    // A box with no size can't be pointed at, so it is left out with all that is in it.
    if (!r.width || !r.height) return null;
    var node = { t: el.tagName.toLowerCase(), r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    if (Object.keys(a).length) node.a = a;
    if (cs.visibility === "hidden" || cs.display === "none") node.hidden = true;
    if (cs.zIndex !== "auto") node.z = Number(cs.zIndex) || 0;
    // The sidebar and the player bar are absolute inside an overflow-hidden frame while the page scrolls in an inner box: they stay put.
    if (cs.position === "fixed" || cs.position === "sticky" || el.matches('nav[aria-label="Main"], [role="region"][aria-label="Player"]')) node.fixed = true;
    if (cs.pointerEvents === "none") node.through = true;
    n++;
    if (node.hidden) return node;
    var kids = [];
    for (var c = el.firstElementChild; c && kids.length < CAP; c = c.nextElementSibling) { var k = walk(c); if (k) kids.push(k); }
    if (kids.length) node.c = kids;
    // Plain text boxes with no attribute say nothing the focus script reads.
    else if (!node.a && !node.hidden && !node.fixed && node.z === undefined && !node.through) return null;
    return node;
  }
  return { url: location.href, view: { width: innerWidth, height: innerHeight }, tree: walk(document.documentElement) };
})()`;

void app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const ses = session.fromPartition(BITCHORD_PARTITION);
  const description = bitchordDescription(
    undefined,
    bridgeNetwork((url, init) => ses.fetch(url, init as RequestInit), SITE),
    process.env,
  );
  const win = new BrowserWindow({
    show: false,
    x: -10000,
    y: -10000,
    width: 1920,
    height: 1080,
    useContentSize: true,
  });
  const hidden = hiddenWindow(win);
  const before = new Set(webContents.getAllWebContents().map((c) => c.id));
  const web = new ElectronWebApp(description, hidden as BrowserWindow);
  const wc = webContents.getAllWebContents().find((c) => !before.has(c.id))!;
  wc.setAudioMuted(true);
  const js = <T,>(code: string) => wc.executeJavaScript(code, true) as Promise<T>;
  web.show();
  const go = async (path: string, wait = 6000) => {
    await wc.loadURL(path.startsWith("http") ? path : `${SITE}${path}`);
    await sleep(wait);
    // The shelves and tables load after the page: wait for them, or the copy holds only the frame.
    for (let i = 0; i < 20; i++) {
      const n = await js<number>(
        `document.querySelectorAll('a[href^="/album"],a[href^="/playlist"],a[href^="/artist"],button[aria-label^="Play "]').length`,
      );
      if (n > 5) break;
      await sleep(1000);
    }
    await sleep(1500);
  };
  const save = async (name: string) => {
    const snap = await js<unknown>(WALK);
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(snap));
    log("saved", name, (snap as { url: string }).url);
  };
  const FRAMES = process.env.BITCHORD_FRAMES;
  // A frame of the page with Couch's focus ring after a few D-pad presses (the ring is drawn in the page).
  const frame = async (name: string, keys: Array<"up" | "down" | "left" | "right">) => {
    if (!FRAMES) return;
    mkdirSync(FRAMES, { recursive: true });
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    const shoot = async (file: string) => {
      // The window is never shown, so the ring's 120 ms slide can freeze half way; a frame wants it where it is going.
      await js(
        `(() => { const r = [...document.body.children].find(e => e.style && e.style.zIndex === "2147483647"); if (r) { r.style.transition = "none"; r.getBoundingClientRect(); } })()`,
      );
      wc.invalidate();
      await sleep(500);
      const shot = (await wc.debugger.sendCommand("Page.captureScreenshot", { format: "png" })) as {
        data: string;
      };
      writeFileSync(join(FRAMES, `${file}.png`), Buffer.from(shot.data, "base64"));
      log("frame", file);
    };
    wc.focus();
    for (const [i, k] of keys.entries()) {
      // After a loadURL of its own the host's key presses no longer reach the page, so the key goes to it as an event.
      await js(
        `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify("Arrow" + k[0]!.toUpperCase() + k.slice(1))}, bubbles: true, cancelable: true }))`,
      );
      await sleep(1200);
      log(
        `  ${name} ${k}: ring`,
        await js<string>(
          `(() => { const r = [...document.body.children].find(e => e.style && e.style.zIndex === "2147483647"); return r ? r.style.left + " " + r.style.top + " " + r.style.width + " " + r.style.height : "none"; })()`,
        ),
      );
      // BITCHORD_STEPS=1 keeps a frame after every key, to see where each press went.
      if (process.env.BITCHORD_STEPS && i < keys.length - 1) await shoot(`${name}-${i + 1}`);
    }
    await shoot(name);
  };
  const links = (re: string) =>
    js<string[]>(
      `[...new Set([...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")).filter(h => new RegExp(${JSON.stringify(re)}).test(h)))].slice(0, 5)`,
    );
  // With a song loaded: BitChord's player bar, its full-screen view and its menus (a song is played from /debug, as bitchord:real does).
  const states = async () => {
    const track = process.env.BITCHORD_TRACKS?.split(",")[0] ?? "ZEcqHA7dbwM";
    await go("/debug", 3000);
    await js(`(() => {
      const input = document.querySelector("form input");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, ${JSON.stringify(track)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form.requestSubmit();
    })()`);
    await sleep(8000);
    await js(
      `[...document.querySelectorAll("a")].find(a => /^\\s*Home/.test(a.innerText))?.click()`,
    );
    for (let i = 0; i < 20; i++) {
      if (
        await js<boolean>(`!!document.querySelector('[role="region"][aria-label="Player"] button')`)
      )
        break;
      await sleep(1000);
    }
    await sleep(2000);
    log(
      "player",
      await js<string>(
        `location.pathname + " " + (document.querySelector('[role="region"][aria-label="Player"]')?.innerText ?? "no bar").slice(0, 80)`,
      ),
    );
    const click = async (sel: string, wait = 1500) => {
      const found = await js<boolean>(
        `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.click(); return !!e; })()`,
      );
      await sleep(wait);
      if (!found) log("missing", sel);
      return found;
    };
    const BAR = '[role="region"][aria-label="Player"]';
    const MORE = 'button[aria-label^="More options for"]';
    const escape = async () => {
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      wc.focus();
      web.sendKey("back");
      await sleep(1200);
      log(
        "after back:",
        await js<string>(
          `location.pathname + " menus " + document.querySelectorAll('[role="menu"]').length + " dialog " + document.querySelectorAll('[role="dialog"]').length`,
        ),
      );
    };
    if (await click(`${BAR} ${MORE}`)) {
      await save("menu");
      await escape();
    }
    if (await click(`${BAR} button[aria-label="Lyrics"]`, 3000)) {
      if (await click('aside[aria-label="Lyrics"] button[aria-haspopup="menu"]')) {
        await save("provider-menu");
        await escape();
      }
      await click(`${BAR} button[aria-label="Lyrics"]`);
    }
    if (await click('button[aria-label="Open full screen player"]', 2500)) {
      await save("fullview");
      if (await click(`[aria-label="Now Playing"] ${MORE}`)) {
        await save("fullview-menu");
        await escape();
      }
      await escape();
    }
  };
  try {
    await go("/home");
    await save("home");
    await frame("home-start", []);
    await frame("home-right", ["right", "right"]);
    const albums = await links("^/album");
    const artists = await links("^/artist");
    const playlists = await links("^/playlist");
    log("links", JSON.stringify({ albums, artists, playlists }));
    await go("/search?q=daft%20punk");
    await save("search");
    await frame("search", ["down", "down"]);
    const sAlbums = await links("^/album"),
      sArtists = await links("^/artist"),
      sPl = await links("^/playlist");
    log("search links", JSON.stringify({ sAlbums, sArtists, sPl }));
    const album = albums[0] ?? sAlbums[0],
      artist = artists[0] ?? sArtists[0],
      pl = playlists[0] ?? sPl[0];
    if (album) {
      await go(album);
      await save("album");
      await frame("album", ["down", "down", "down", "down", "down"]);
    }
    if (artist) {
      await go(artist);
      await save("artist");
      await frame("artist", ["down", "down"]);
    }
    if (pl) {
      await go(pl);
      await save("playlist");
      await frame("playlist", ["down", "down", "down", "down"]);
    }
    await states();
  } catch (e) {
    log("threw", String(e));
  }
  web.dispose();
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {}
  app.exit(0);
});
