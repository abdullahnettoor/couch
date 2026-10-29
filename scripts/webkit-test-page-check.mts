// Headless check of the dev test page (ticket 111): Couch's WebKit host plays the synthetic clip while the overlays
// that live in the page (search bar, note) come and go and the ones Couch's own screen draws (volume, question) add
// nothing to it. The window is never shown; the store is non-persistent; the page is a loopback server, not Netflix;
// no network, no Couch userData. Run: node scripts/webkit-test-page-check.mjs
import { app, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWebKitBridge, type WebKitAddon } from "../src/main/mpv/embed-addon.ts";
import { findFfmpeg } from "../src/main/ports/thumbnails.ts";
import { netflixDescription } from "../src/main/apps/netflix/netflix-web.ts";
import {
  ensureTestClip,
  serveTestPage,
  testPageDescription,
} from "../src/main/web/webkit-test-page.ts";
import type { WebKitView } from "../src/main/web/webkit-bridge.ts";
import { WebKitWebApp } from "../src/main/web/webkit-web-app.ts";
import type { YouTubeEvent } from "../src/main/ports/youtube.ts";

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`TESTPAGE ${ok ? "ok  " : "FAIL"} ${what}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

app.dock?.hide();
void app.whenReady().then(async () => {
  const timeout = setTimeout(() => {
    console.log("TESTPAGE timeout");
    app.exit(2);
  }, 90000);
  let close: (() => Promise<void>) | undefined;
  try {
    const win = new BrowserWindow({ show: false, width: 1280, height: 720 });
    const addon = createRequire(import.meta.url)(
      resolve("native/mpv-embed/mpv_embed.node"),
    ) as WebKitAddon;
    const real = createWebKitBridge(
      () => win,
      () => addon,
    );
    if (!real) {
      console.log("TESTPAGE skipped: no WebKit support");
      return app.exit(0);
    }
    let view: WebKitView | undefined;
    const bridge = {
      ...real,
      userAgent: () => real.userAgent(),
      create: (o: Parameters<typeof real.create>[0]) => (view = real.create(o)),
    };
    const clip = await ensureTestClip(
      mkdtempSync(join(tmpdir(), "couch-test-page-")),
      findFfmpeg(),
    );
    check(clip !== undefined, "ffmpeg made the synthetic clip");
    if (!clip) throw new Error("no clip");
    const server = await serveTestPage(clip);
    close = server.close;
    const host = new WebKitWebApp(
      testPageDescription(netflixDescription(), server.origin),
      bridge,
      {
        getContentBounds: () => win.getContentBounds(),
        onResize: (cb) => void win.on("resize", cb),
        reveal: async () => {},
      },
      { ephemeral: true },
    );
    const events: YouTubeEvent[] = [];
    host.onEvent((e) => events.push(e));
    host.show("Press Home on your phone to come back");
    const until = async (what: string, test: () => boolean, ms = 20000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (test()) return true;
        await sleep(200);
      }
      check(false, `timed out: ${what}`);
      return false;
    };
    await until("loaded", () => events.some((e) => e.type === "loaded"));
    check(
      events.some((e) => e.type === "loaded"),
      "the test page finished loading and was reported loaded",
    );
    const playbacks = () =>
      events.flatMap((e) => (e.type === "playback" && e.playback ? [e.playback] : []));
    await until("playing", () => playbacks().some((p) => p.paused === false));
    const first = playbacks().find((p) => p.paused === false);
    check(
      !!first && (first.duration ?? 0) > 0,
      "Netflix's own probe reports the synthetic video playing",
    );
    const position = () => playbacks().at(-1)?.position ?? -1;
    const p0 = position();
    await sleep(2500);
    check(position() > p0, "the clip's position advances");
    const dom = (id: string) =>
      view!.evaluate(
        `(function(){var e=document.getElementById(${JSON.stringify(id)});return e?e.textContent:null})()`,
        { kind: "expression" },
      );
    const eval_ = (code: string) => view!.evaluate(code, { kind: "expression" });
    check(
      (await eval_(`getComputedStyle(document.documentElement).scrollbarWidth`)) === "none",
      "hideScrollbars: the page's scrollbars are hidden",
    );
    check(
      (await eval_(`typeof window.couchHost`)) === "object" &&
        (await eval_(`document.documentElement.dataset.pageSawHost`)) === "undefined",
      "couchHost exists for Couch's scripts and not for the page's own",
    );
    check(
      playbacks().some((p) => p.title === "Test Pattern"),
      "the page's MediaSession title is read by Couch's probe from the couch world",
    );
    check(
      (await eval_(`new KeyboardEvent("keydown", { key: "Escape", keyCode: 27 }).keyCode`)) === 27,
      "a keyCode given to a synthetic KeyboardEvent is kept (Netflix's menus close that way)",
    );
    check((await dom("couch-note")) !== null, "the first-show note is drawn in the page");
    host.showSearchBar("hello");
    await sleep(300);
    check(
      (await dom("couch-search"))?.toString().includes("hello") === true,
      "the search bar shows the typed text",
    );
    host.showVolume(40);
    host.showConfirm({ title: "Leave Netflix?", buttons: ["Go to Home", "Stay"], focus: 0 });
    await sleep(300);
    check(
      (await dom("couch-volume")) === null,
      "the volume display is not injected (Couch's screen draws it)",
    );
    check(
      (await dom("couch-confirm")) === null,
      "the question is not injected (Couch's screen draws it)",
    );
    host.showConfirm(undefined);
    host.showVolume(undefined);
    host.showSearchBar(undefined);
    await sleep(300);
    check((await dom("couch-search")) === null, "the search bar is gone");
    const p1 = position();
    await sleep(2500);
    const last = playbacks().at(-1);
    check(
      position() > p1 && last?.paused === false,
      "the clip is still playing after every overlay came and went",
    );
    const clicks = async () => Number(await eval_(`document.documentElement.dataset.clicks`));
    host.sendKey("ok");
    await sleep(400);
    check((await clicks()) === 1, "OK clicks the control Couch's focus ring is on");
    check(
      (await eval_(`sessionStorage.getItem("couchNfArt") !== null`)) === true,
      "the box-art recorder (page world) ran on that click and its storage is readable from Couch's world",
    );
    await eval_(`document.documentElement.dataset.takeEnter = "1"`);
    host.sendKey("ok");
    await sleep(400);
    check(
      (await clicks()) === 1,
      "a key the page handles itself (preventDefault in its own handler) is not also taken by Couch's ring",
    );
    await eval_(`delete document.documentElement.dataset.takeEnter`);
    host.hide();
    await sleep(500);
    const paused = await view!.evaluate(
      `(function(){var v=document.querySelector("video");return v?v.paused:null})()`,
      { kind: "expression" },
    );
    check(paused === true, "hiding the App (leaving it) pauses it, unlike every overlay");
  } catch (error) {
    failures.push(String(error));
    console.log(`TESTPAGE error ${String(error)}`);
  }
  await close?.();
  clearTimeout(timeout);
  console.log(
    failures.length === 0 ? "TESTPAGE all ok" : `TESTPAGE FAILED: ${failures.join("; ")}`,
  );
  app.exit(failures.length === 0 ? 0 : 1);
});
