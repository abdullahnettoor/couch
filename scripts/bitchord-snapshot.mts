// Records BitChord's live pages as page snapshots (the test fixtures in src/main/apps/bitchord/fixtures), by hand:
//   pnpm bitchord:snapshot [outDir]
// Signed out, muted, offscreen (a window that is never shown), on a temp userData. It also saves a frame of each page with
// Couch's real focus ring when BITCHORD_FRAMES=<dir> is set (1920 pt wide, so the page's 1280×720 at the default Text size). Not in CI: it hits the live site.
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

const walkSource = (end: boolean) => `(function () {
  // What the focus tests read: the rest of a page's attributes, and all but its song-row classes, only add size.
  var KEEP = ["href","role","tabindex","aria-label","aria-modal","aria-hidden","aria-disabled","type","placeholder","disabled"];
  // A list keeps its first rows or cards; the focus tests walk a few and a snapshot of a whole playlist is a megabyte.
  var CAP = ${end ? 40 : 12};
  // At a page's end the rows that scrolled off are left out, so a long page's last rows fit in a small copy.
  var END = ${end};
  var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,LINK:1,META:1,HEAD:1,TITLE:1,PATH:1,CIRCLE:1,RECT:1,LINE:1,POLYLINE:1,POLYGON:1,G:1,DEFS:1,SVG:1,IMG:1,PICTURE:1,SOURCE:1};
  var n = 0;
  function walk(el) {
    if (SKIP[el.tagName.toUpperCase()] || n > 6000) return null;
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var a = {};
    KEEP.forEach(function (k) { var v = el.getAttribute(k); if (v !== null) a[k] = v.slice(0, 200); });
    var rows = String(el.getAttribute("class") || "").split(/s+/).filter(function (c) { return c.indexOf("group/track") === 0 || c.indexOf("group/row") === 0; });
    if (rows.length) a["class"] = rows.join(" ");
    // A box with no size can't be pointed at, so it is left out with all that is in it.
    if (!r.width || !r.height) return null;
    if (END && el !== document.documentElement && el !== document.body && (r.bottom < 0 || r.top > innerHeight) && !el.closest('nav[aria-label="Main"], [role="region"][aria-label="Player"]')) return null;
    // Couch's own highlight and shield, drawn over the page by the focus script, are not the page's.
    if (Number(cs.zIndex) >= 2147483000) return null;
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
const WALK = walkSource(false);

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
  // The window is never shown, so the page would stop drawing (a virtualised list draws its rows on animation frames): emulate focus.
  wc.debugger.attach("1.3");
  await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
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
  // The page scrolled to its very end (a long list's last rows sit at the screen's bottom edge, under the player bar).
  const saveEnd = async (name: string) => {
    wc.focus();
    // A virtualised list draws its rows as the page is walked, so the page goes to its end the way the household does: Down, a press at a time, until the page stops scrolling.
    let still = 0;
    for (let i = 0, last = ""; i < 140 && still < 6; i++) {
      await js(
        `window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))`,
      );
      await sleep(350);
      // Where the page is and where the ring is: while either moves the walk goes on.
      const at = await js<string>(
        `(() => { const r = [...document.body.children].find((e) => e.style && e.style.zIndex === "2147483647"); return (document.querySelector("main")?.scrollTop ?? 0) + "/" + (r ? r.style.left + r.style.top : ""); })()`,
      );
      still = at === last ? still + 1 : 0;
      last = at;
    }
    await sleep(1500);
    log(
      "page text",
      (
        await js<string>(
          `document.body.innerText.slice(0, 80) + " | plays " + [...document.querySelectorAll('button[aria-label^="Play "]')].map((b) => Math.round(b.getBoundingClientRect().top)).slice(-4) + " | rows " + document.querySelectorAll('[class*="group/"]').length + " scroll " + [...document.querySelectorAll("*")].filter((e) => e.scrollTop > 0).map((e) => e.tagName + e.scrollTop + "/" + e.scrollHeight)`,
        )
      ).replace(/\s+/g, " "),
    );
    const snap = await js<unknown>(walkSource(true));
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
  try {
    await go("/home");
    await save("home");
    await saveEnd("home-end");
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
    await go("/settings");
    await save("settings");
    await frame("settings", ["down", "down", "down", "down", "down", "down", "down", "down"]);
    await go("/extension");
    await save("extension");
    await frame("extension", []);
    // A 100-song playlist, saved at its end: its rows are virtualised, and its last row sits at the screen's bottom edge, level with the player bar.
    await go(
      process.env.BITCHORD_LONG_PLAYLIST ?? "/playlist/VLPLO7-VO1D0_6MlO4UxJWFBUq3U-7zoIBf7",
    );
    await saveEnd("playlist-long-end");
  } catch (e) {
    log("threw", String(e));
  }
  web.dispose();
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {}
  app.exit(0);
});
