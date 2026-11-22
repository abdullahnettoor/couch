// Headless native check of WebKit's page zoom for Text size (#62), run in two launches by scripts/webkit-zoom-check.mjs:
// "save" zooms a view on a persistent test store and exits; "check" relaunches on the same store and checks a new view
// starts at 1 (WebKit keeps no zoom across launches), that a zoom is per view, and that Couch's real WebKit host zooms
// by Text size's formula with Couch's overlays keeping their size. A loopback page on 127.0.0.1:47751 (not Netflix), a
// window that is never shown, a throwaway store removed at the end, no Couch userData.
import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { netflixDescription } from "../src/main/apps/netflix/netflix-web.ts";
import { createWebKitBridge, type WebKitAddon } from "../src/main/mpv/embed-addon.ts";
import { SHIELD_ID, WAKE_POINTER_SOURCE } from "../src/main/web/pointer-wake.ts";
import { textZoom, type TextSize } from "../src/shared/text-size.ts";
import { WebKitWebApp } from "../src/main/web/webkit-web-app.ts";
import type { YouTubeEvent } from "../src/main/ports/youtube.ts";
import type { WebKitView } from "../src/main/web/webkit-bridge.ts";

const PORT = 47751;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PHASE = process.env.COUCH_ZOOM_PHASE;
const STORE = process.env.COUCH_ZOOM_STORE ?? "";
const WIDTH = 1920;
const TARGET = 1440;

const addon = createRequire(import.meta.url)(
  resolve("native/mpv-embed/mpv_embed.node"),
) as WebKitAddon;
const failures: string[] = [];
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failures.push(what);
  console.log(`ZOOM ${ok ? "ok  " : "FAIL"} ${what}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><meta charset=utf-8><title>zoom</title><body style="margin:0;background:#123"><p>Text size</p></body>`;

/** A view on `store` ("" = non-persistent), loaded at the loopback page; resolves once it has loaded. */
async function view(win: BrowserWindow, store: string) {
  let loaded: () => void = () => {};
  const done = new Promise<void>((r) => (loaded = r));
  const id = addon.webkitCreate(win.getNativeWindowHandle(), store, "Couch-zoom-check", (kind) => {
    if (kind === "loaded") loaded();
  });
  addon.webkitSetFrame(id, 0, 0, WIDTH, 1080);
  addon.webkitSetVisible(id, true);
  addon.webkitLoad(id, `${ORIGIN}/`);
  await Promise.race([done, sleep(10000)]);
  const js = (s: string) =>
    new Promise<unknown>((res, rej) =>
      addon.webkitEvaluate(id, s, "expression", (e, json) =>
        e === null ? res((JSON.parse(json) as unknown[])[0]) : rej(new Error(e)),
      ),
    );
  const snapshot = () =>
    new Promise<{ pageZoom: number }>((res, rej) =>
      addon.webkitSnapshot(id, "", (e, json) =>
        e === null ? res((JSON.parse(json) as Array<{ pageZoom: number }>)[0]!) : rej(new Error(e)),
      ),
    );
  return { id, js, snapshot, innerWidth: async () => Number(await js("innerWidth")) };
}

app.dock?.hide();
void app.whenReady().then(async () => {
  const timeout = setTimeout(() => {
    console.log("ZOOM timeout");
    app.exit(2);
  }, 60000);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
  });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
  try {
    if (!addon.webkitSupported()) {
      console.log("ZOOM skipped: no WebKit support");
      return app.exit(0);
    }
    if (!/^[0-9A-F-]{36}$/i.test(STORE)) throw new Error("COUCH_ZOOM_STORE must be a fresh UUID");
    if (PHASE === "cleanup") {
      // WebKit has to be running in this process before a store can be removed.
      const warm = new BrowserWindow({ show: false, width: 320, height: 200 });
      addon.webkitDestroy((await view(warm, "")).id);
      await sleep(500);
      const removed = await new Promise<string | null>((r) => addon.webkitRemoveStore(STORE, r));
      console.log(
        `ZOOM cleanup: ${removed === null ? "the throwaway store is removed" : `store not removed (${removed})`}`,
      );
      server.close();
      clearTimeout(timeout);
      return app.exit(removed === null ? 0 : 1);
    }
    const win = new BrowserWindow({
      show: false,
      width: WIDTH,
      height: 1080,
      useContentSize: true,
    });

    if (PHASE === "save") {
      const a = await view(win, STORE);
      addon.webkitSetPageZoom(a.id, 1.5);
      await sleep(300);
      check(
        (await a.innerWidth()) === 1280,
        "a page zoom of 1.5 lays the page out at 1280 CSS px",
        `innerWidth ${await a.innerWidth()}`,
      );
      const b = await view(win, STORE);
      check(
        (await b.innerWidth()) === WIDTH,
        "another view on the same store and origin stays at 1 (the zoom is per view)",
        `innerWidth ${await b.innerWidth()}`,
      );
      addon.webkitLoad(a.id, `${ORIGIN}/other`);
      await sleep(1500);
      check(
        (await a.innerWidth()) === 1280,
        "the zoomed view keeps its zoom across a navigation",
        `innerWidth ${await a.innerWidth()}`,
      );
      await a.js("(localStorage.setItem('couch-zoom-check', 'kept'), true)");
      // The store's data reaches the disk before the process ends.
      await sleep(1500);
      addon.webkitDestroy(a.id);
      addon.webkitDestroy(b.id);
    } else {
      const fresh = await view(win, STORE);
      check(
        (await fresh.innerWidth()) === WIDTH,
        "after a relaunch on the same store, a new view starts at 1 (nothing kept)",
        `innerWidth ${await fresh.innerWidth()}`,
      );
      check((await fresh.snapshot()).pageZoom === 1, "its pageZoom reads 1");
      check(
        (await fresh.js("localStorage.getItem('couch-zoom-check')")) === "kept",
        "...while the store did keep the page's own data across the relaunch (so the store is the same one)",
      );
      addon.webkitDestroy(fresh.id);
      await sleep(500);
      const removed = await new Promise<string | null>((r) => addon.webkitRemoveStore(STORE, r));
      check(removed === null, "the throwaway store is removed", removed ?? "");

      // Couch's real WebKit host, sized like Netflix, over the loopback page (a non-persistent store).
      // The window is never shown; it only says it is key, so WebKit hands its views a hover move as in a shown window.
      addon.webkitTestKeyWindow(win.getNativeWindowHandle());
      const real = createWebKitBridge(
        () => win,
        () => addon,
      )!;
      let hostView: WebKitView | undefined;
      const bridge = {
        ...real,
        userAgent: () => real.userAgent(),
        create: (o: Parameters<typeof real.create>[0]) => (hostView = real.create(o)),
      };
      let resizeCb: () => void = () => {};
      let width = WIDTH;
      const desc = {
        ...netflixDescription(),
        url: `${ORIGIN}/`,
        isOwnOrigin: (o: string) => o === ORIGIN,
      };
      const host = new WebKitWebApp(
        desc,
        bridge,
        {
          getContentBounds: () => ({ width, height: 1080 }),
          onResize: (cb) => void (resizeCb = cb),
          reveal: async () => {},
        },
        { ephemeral: true },
      );
      check(host.supportsTextSize === true, "Netflix's description opts in to Text size");
      const events: YouTubeEvent[] = [];
      host.onEvent((e) => events.push(e));
      host.show();
      for (let i = 0; i < 50 && !events.some((e) => e.type === "loaded"); i++) await sleep(200);
      check(
        events.some((e) => e.type === "loaded"),
        "the host's page loaded",
      );
      const measure = async () =>
        (await hostView!
          .evaluate(
            `(() => { const b = document.getElementById('couch-search'); return { iw: innerWidth, bar: b ? b.getBoundingClientRect().width : 0 }; })()`,
            { kind: "expression" },
          )
          .catch(() => null)) as { iw: number; bar: number } | null;
      // The bar is drawn once, then Text size changes under it: it must keep its size on screen.
      host.showSearchBar("hello");
      for (const size of ["default", "larger", "smaller", "default"] as TextSize[]) {
        host.setTextSize(size);
        await sleep(500);
        const z = textZoom(width, TARGET, size);
        const m = await measure();
        const css = Math.round(WIDTH / z);
        check(
          !!m && Math.abs(m.iw - css) <= 1 && Math.abs(m.bar * z - 1000) < 2,
          `${size}: the page is ${css} CSS px wide (zoom ${z.toFixed(3)}) and the search bar stays 1000 pt on screen`,
          m ? `innerWidth ${m.iw}, bar ${(m.bar * z).toFixed(1)} pt` : "no page",
        );
      }
      // Couch's wake of a player's bar under a page zoom: the real move it makes must come back at the client point the
      // page asked for, so the D-pad shield knows it for Couch's own and D-pad mode stays on.
      const js = (s: string) => hostView!.evaluate(s, { kind: "expression" }).catch(() => null);
      await js(
        `(window.__wakeMoves || (window.__wakeMoves = [], addEventListener('mousemove', function (e) { if (e.isTrusted) window.__wakeMoves.push([e.clientX, e.clientY]); }, true)), true)`,
      );
      let step = 0;
      for (const size of ["smaller", "default", "larger"] as TextSize[]) {
        host.setTextSize(size);
        await sleep(500);
        await js(
          `(window.__wakeMoves.length = 0, document.documentElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' })), true)`,
        );
        const pairs: string[] = [];
        let agree = true;
        for (let i = 0; i < 8; i++) {
          const asked = (await js(`((${WAKE_POINTER_SOURCE})(${++step}), window.__couchWake)`)) as {
            x: number;
            y: number;
          } | null;
          await sleep(150);
          const moves = ((await js("window.__wakeMoves")) ?? []) as Array<[number, number]>;
          const got = moves[moves.length - 1];
          const ok =
            !!asked &&
            !!got &&
            moves.length === i + 1 &&
            Math.abs(got[0] - asked.x) <= 2 &&
            Math.abs(got[1] - asked.y) <= 2;
          if (!ok) agree = false;
          if (i < 2 || !ok)
            pairs.push(
              `${asked ? `${asked.x},${asked.y}` : "?"} → ${got ? `${got[0]},${got[1]}` : "none"}`,
            );
        }
        check(
          agree,
          `${size}: each of 8 wakes comes back as a real move at the client point asked for (within 2 px)`,
          pairs.join("; "),
        );
        const state = (await js(
          `({ dpad: document.documentElement.hasAttribute('data-couch-dpad'), shield: !!document.getElementById(${JSON.stringify(SHIELD_ID)}) })`,
        )) as { dpad: boolean; shield: boolean } | null;
        check(
          !!state?.dpad && !!state.shield,
          `${size}: after the wakes, D-pad mode and the hover shield are still on`,
          `dpad ${state?.dpad}, shield ${state?.shield}`,
        );
      }
      host.setTextSize("default");
      await sleep(300);

      width = 2880;
      resizeCb();
      await sleep(400);
      const wide = await measure();
      check(
        !!wide && Math.abs(wide.iw - TARGET) <= 1 && Math.abs(wide.bar * 2 - 1000) < 2,
        "a wider window (a display move) zooms more and keeps 1440 CSS px at Default",
        `innerWidth ${wide?.iw}, bar ${((wide?.bar ?? 0) * 2).toFixed(1)} pt`,
      );
      host.dispose();
    }
    win.destroy();
  } catch (error) {
    check(false, `error ${String(error)}`);
  }
  server.close();
  clearTimeout(timeout);
  console.log(failures.length === 0 ? `ZOOM passed (${PHASE})` : `ZOOM failed: ${failures.length}`);
  app.exit(failures.length === 0 ? 0 : 1);
});
