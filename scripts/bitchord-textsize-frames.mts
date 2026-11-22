// BitChord at each Text size (#61), by hand: pnpm bitchord:sizes [outDir]. Signed out, muted, offscreen, 1920×1080, temp userData.
// Frames of home, an album, search and the player bar at Smaller / Default / Larger, with the focus ring, plus overflow and reach measures.
import { app, BrowserWindow, session, webContents } from "electron";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bridgeNetwork } from "../src/main/apps/bitchord/bitchord-network.ts";
import { bitchordSite } from "../src/main/apps/bitchord/bitchord-route.ts";
import { BITCHORD_PARTITION, bitchordDescription } from "../src/main/apps/bitchord/bitchord-web.ts";
import { ElectronWebApp } from "../src/main/web/electron-web-app.ts";

const userData = mkdtempSync(join(tmpdir(), "couch-bitchord-size-"));
app.setPath("userData", userData);
app.commandLine.appendSwitch("mute-audio");
app.dock?.hide();

const SITE = bitchordSite(process.env);
const OUT = resolve(
  process.argv.find((a, i) => i > 1 && !a.startsWith("-") && !a.endsWith(".mts")) ?? "frames",
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log("[bitchord-textsize]", ...a);

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
  const hidden = new Proxy(win, {
    get(target, key) {
      if (key === "isFocused" || key === "isVisible") return () => true;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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
  const FRAMES = OUT;
  const SIZES = ["smaller", "default", "larger"] as const;
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
  const measure = (name: string) =>
    js<unknown>(`(() => {
      const de = document.documentElement;
      const bar = document.querySelector('[role="region"][aria-label="Player"]');
      const r = bar && bar.getBoundingClientRect();
      const ring = [...document.body.children].find(e => e.style && e.style.zIndex === "2147483647");
      const q = ring && ring.getBoundingClientRect();
      return { name: ${JSON.stringify(name)}, innerWidth, scrollW: de.scrollWidth, hOverflow: de.scrollWidth > innerWidth + 1,
        bar: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), innerHeight] : null,
        ring: q ? [Math.round(q.left), Math.round(q.top), Math.round(q.right), Math.round(q.bottom)] : null };
    })()`);
  try {
    const results: unknown[] = [];
    await go("/search?q=daft%20punk");
    let albums = await links("^/album");
    if (!albums.length) albums = ["/album/MPREb_7ltM34kr0mH"];
    log("albums", JSON.stringify(albums));
    for (const size of SIZES) {
      web.setTextSize(size);
      await sleep(1500);
      const zoom = wc.getZoomFactor();
      log(size, "zoom", zoom);
      await go("/home");
      await frame(`${size}-home`, ["right", "right"]);
      results.push({ size, zoom, ...((await measure(`${size}-home`)) as object) });
      await go("/search?q=daft%20punk");
      await frame(`${size}-search`, ["down", "down"]);
      results.push({ size, zoom, ...((await measure(`${size}-search`)) as object) });
      {
        // The player bar: press down from Home until the ring sits inside the bar, then right for another button.
        await go(albums[0] ?? "/home");
        wc.focus();
        const key = (k: string) =>
          js(
            `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`,
          );
        const inBar = () =>
          js<boolean>(
            `(() => { const b = document.querySelector('[role="region"][aria-label="Player"]').getBoundingClientRect(); const r = [...document.body.children].find(e => e.style && e.style.zIndex === "2147483647"); if (!r) return false; const q = r.getBoundingClientRect(); const x = q.left + q.width / 2, y = q.top + q.height / 2; return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; })()`,
          );
        let n = 0;
        for (; n < 45 && !(await inBar()); n++) {
          await key("ArrowDown");
          await sleep(500);
        }
        log(size, "reached the player bar after", n, "downs:", await inBar());
        results.push({ size, zoom, reachedBar: await inBar(), downs: n });
        await frame(`${size}-bar`, []);
        await frame(`${size}-bar-right`, ["right", "right"]);
        results.push({ size, zoom, ...((await measure(`${size}-bar-right`)) as object) });
      }
      if (albums[0]) {
        await go(albums[0]);
        await frame(`${size}-album`, ["down", "down", "down"]);
        results.push({ size, zoom, ...((await measure(`${size}-album`)) as object) });
        // Every focusable control the ring can reach: walk down and right, then count distinct ring spots.
        const spots = new Set<string>();
        for (const k of [
          "down",
          "down",
          "down",
          "down",
          "right",
          "right",
          "down",
          "down",
        ] as const) {
          await js(
            `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify("Arrow" + k[0]!.toUpperCase() + k.slice(1))}, bubbles: true, cancelable: true }))`,
          );
          await sleep(500);
          const m = (await measure("walk")) as { ring: number[] | null };
          if (m.ring) spots.add(m.ring.join(","));
        }
        log(size, "distinct ring spots on the album", spots.size);
        await frame(`${size}-album-bottom`, ["down", "down", "down", "down", "down", "down"]);
        results.push({ size, zoom, ...((await measure(`${size}-album-bottom`)) as object) });
      }
    }
    writeFileSync(join(FRAMES, "measures.json"), JSON.stringify(results, null, 1));
    log(JSON.stringify(results));
  } catch (e) {
    log("threw", String(e));
  }
  web.dispose();
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {}
  app.exit(0);
});
