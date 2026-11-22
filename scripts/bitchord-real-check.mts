// The BitChord real-site check (#52), run by hand: pnpm bitchord:real. Not in CI.
// It loads the live BitChord site through Couch's real BitChord description and web-App host, muted, offscreen and on a
// temp userData (no window is shown, no ports are used, Couch's own data is never touched), then checks that:
//   1. BitChord's Extension page says the extension is installed (and asks for no update),
//   2. a known song from BitChord's /debug page plays past 90 s, and two more for 20 s each,
//   3. an age-restricted song shows BitChord's own sign-in message,
//   4. lyrics load for the long song: the bridge fetched a listed lyric host and BitChord's lyrics view shows lines,
//   5. from the Remote's keys: the full view opens with the ring on Pause, a ⋯ menu opens on its first item with the ring
//      following BitChord's own focus, and Back closes the menu, then the view, with the page left as it was,
//   6. Down reaches the player bar on a long playlist, on Play/Pause, from its last row and from its middle via the sidebar (#73);
//      BITCHORD_FRAMES=<dir> saves a frame of each.
// The window is 1920 pt wide with Text size applied (BITCHORD_TEXT_SIZE, default "default").
// BITCHORD_SITE overrides the site; BITCHORD_TRACKS=a,b,c and BITCHORD_AGE_RESTRICTED=id override the songs;
// BITCHORD_LONG (seconds, default 95) shortens the long play for a quick look; the long song must reach 90 s (or that shorter
// wish), the others 20 s, with no tolerance.
import { app, BrowserWindow, session, webContents } from "electron";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lyricOrigin } from "../src/main/apps/bitchord/bitchord-lyrics.ts";
import { bridgeNetwork } from "../src/main/apps/bitchord/bitchord-network.ts";
import { bitchordSite } from "../src/main/apps/bitchord/bitchord-route.ts";
import { ownArtwork, playbackProbe } from "../src/main/web/playback.ts";
import { BITCHORD_PARTITION, bitchordDescription } from "../src/main/apps/bitchord/bitchord-web.ts";
import type { TextSize } from "../src/shared/text-size.ts";
import { ElectronWebApp } from "../src/main/web/electron-web-app.ts";
import { hiddenWindow } from "./lib/hidden-window.mts";

const userData = mkdtempSync(join(tmpdir(), "couch-bitchord-check-"));
app.setPath("userData", userData);
app.commandLine.appendSwitch("mute-audio");
app.dock?.hide();

const SITE = bitchordSite(process.env);
const [LONG_TRACK, ...OTHER_TRACKS] = (
  process.env.BITCHORD_TRACKS ?? "ZEcqHA7dbwM,J7p4bzqLvCw,NJAv_7lHUIU"
).split(",");
const AGE_RESTRICTED = process.env.BITCHORD_AGE_RESTRICTED ?? "Tq92D6wQ1mg";
const LONG_SECONDS = Number(process.env.BITCHORD_LONG ?? 95);
const LONG_MIN = Math.min(90, LONG_SECONDS);
const SHORT_SECONDS = 20;
const log = (...a: unknown[]) => console.log("[bitchord-check]", ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
const expectThat = (ok: boolean, what: string) => {
  log(ok ? "ok  " : "FAIL", what);
  if (!ok) failures.push(what);
};

void app.whenReady().then(async () => {
  const ses = session.fromPartition(BITCHORD_PARTITION);
  const lyricFetches: string[] = [];
  const network = bridgeNetwork((url, init) => ses.fetch(url, init as RequestInit), SITE);
  const description = bitchordDescription(
    undefined,
    {
      ...network,
      async request(init) {
        const response = await network.request(init);
        if (lyricOrigin(init.url) && response.status === 200) lyricFetches.push(init.url);
        return response;
      },
    },
    process.env,
  );
  // A window that is never shown, far off screen. The host asks to reveal it only when it is not "focused and visible", so say it is.
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
  const wc = webContents
    .getAllWebContents()
    .find((c) => !before.has(c.id) && c.getURL() !== undefined)!;
  wc.setAudioMuted(true);
  wc.on("console-message", (e: { message?: string }) => {
    if (/bitchord|bridge/i.test(e.message ?? "") && !e.message?.startsWith("couch:host:"))
      log("page:", e.message?.slice(0, 200));
  });
  const js = <T,>(code: string) => wc.executeJavaScript(code, true) as Promise<T>;
  // Text size applies: the window is 1920 pt wide, so BitChord runs zoomed (BITCHORD_TEXT_SIZE=smaller|default|larger).
  web.setTextSize((process.env.BITCHORD_TEXT_SIZE ?? "default") as TextSize);
  web.show();
  const go = async (path: string) => {
    await wc.loadURL(`${SITE}${path}`);
    await sleep(3000);
  };

  try {
    await go("/extension");
    await sleep(3000);
    const text = await js<string>(
      `(document.querySelector('main') ?? document.body).innerText.slice(0, 1500)`,
    );
    log("Extension page says:", JSON.stringify(text.replace(/\s+/g, " ").slice(0, 700)));
    // BitChord's session refuses every download: the session sees it start, and nothing is saved.
    let downloads = 0;
    const saved: string[] = [];
    const seen = (_e: unknown, item: { getSavePath(): string }) => {
      downloads++;
      setImmediate(() => saved.push(item.getSavePath()));
    };
    ses.prependListener("will-download", seen);
    wc.downloadURL(`${SITE}/home`);
    await sleep(4000);
    ses.off("will-download", seen);
    expectThat(downloads > 0, "a download started in the page reaches the session");
    expectThat(
      saved.every((p) => !p),
      "…and nothing is saved (the download is cancelled)",
    );
    const ping = await js<{
      ok?: boolean;
      result?: { version: string; browser: string };
    } | null>(`new Promise((resolve) => {
      const id = "check-" + Math.random();
      const on = (e) => {
        if (e.source !== window || !e.data || e.data.direction !== "to-page" || e.data.id !== id) return;
        removeEventListener("message", on);
        resolve(e.data);
      };
      addEventListener("message", on);
      postMessage({ channel: "bitchord-bridge", protocol: 1, direction: "to-extension", id, method: "ping", params: {} }, location.origin);
      setTimeout(() => resolve(null), 5000);
    })`);
    log("ping answered:", JSON.stringify(ping));
    expectThat(
      ping?.ok === true && ping.result?.browser === "chromium",
      "the page's bridge ping is answered",
    );
    // With the extension present BitChord sends /extension on to its home instead of showing the install steps.
    expectThat(
      !/install|download|get the extension/i.test(text) &&
        !(await js<string>("location.pathname")).startsWith("/extension"),
      "the Extension page offers no install and asks for no update",
    );

    const play = async (id: string, seconds: number) => {
      await go("/debug");
      // The player's media element needn't be in the DOM; catch it when it plays.
      await js(`(() => {
        window.__media = new Set();
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { window.__media.add(this); return play.call(this); };
        const input = document.querySelector("form input");
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(input, ${JSON.stringify(id)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.form.requestSubmit();
      })()`);
      let position = 0;
      for (let s = 0; s < seconds + 15 && position < seconds; s += 5) {
        await sleep(5000);
        const m = await js<{ t: number; paused: boolean; muted: boolean }>(`(() => {
          const m = [...window.__media, ...document.querySelectorAll("audio,video")].sort((a, b) => b.currentTime - a.currentTime)[0];
          return m ? { t: Math.round(m.currentTime), paused: m.paused, muted: m.muted } : { t: 0, paused: true, muted: false };
        })()`);
        position = m.t;
        log(`  ${id} +${s + 5}s position ${m.t}s ${m.paused ? "paused" : "playing"}`);
      }
      const lines = await js<string>(
        `document.querySelector("main")?.innerText.split("\\n").filter(l => /refus|error|age|sign in|client|VISIONOS|WEB/i.test(l)).slice(-6).join(" | ") ?? ""`,
      );
      return { position, lines };
    };

    const long = await play(LONG_TRACK!, LONG_SECONDS);
    expectThat(
      long.position >= LONG_MIN,
      `${LONG_TRACK} played to ${long.position}s (wanted at least ${LONG_MIN} s)`,
    );
    // Back in BitChord's own pages the song keeps playing; open its Lyrics view and wait for lines.
    await js(
      `(() => { const a=[...document.querySelectorAll("a")].find(a=>/^\\s*Home/.test(a.innerText)); a&&a.click(); })()`,
    );
    await sleep(4000);
    await js(`document.querySelector('[aria-label="Lyrics"]')?.click()`);
    await sleep(8000);
    const lyricsText = await js<string>(`document.body.innerText`);
    log(
      "lyric fetches:",
      JSON.stringify(lyricFetches.slice(0, 5)),
      "page text:",
      JSON.stringify(lyricsText.replace(/\s+/g, " ").slice(-200)),
    );
    expectThat(
      lyricFetches.length > 0,
      `lyrics for ${LONG_TRACK} were fetched from a listed lyric host`,
    );
    // BitChord's lyrics view ends with the provider that supplied the lines.
    expectThat(
      /lrc\.red|binimum|boidu|paxsenix|lyricsplus|lyrics-plus|lrclib|kugou|musixmatch|genius|apple/i.test(
        lyricsText.slice(-80),
      ),
      "BitChord's lyrics view names the provider that supplied the lyrics",
    );
    for (const id of OTHER_TRACKS) {
      const short = await play(id, SHORT_SECONDS);
      expectThat(
        short.position >= SHORT_SECONDS,
        `${id} played to ${short.position}s (wanted at least ${SHORT_SECONDS} s)`,
      );
    }

    // Now Playing (#54): the adapter's probe, play/pause and a direct seek on the real player.
    const adapter = description.playback!;
    const probe = () =>
      js<{ position: number; paused: boolean; title?: string; artwork?: string } | undefined>(
        playbackProbe({ speeds: adapter.speeds }),
      );
    await play(OTHER_TRACKS[0] ?? LONG_TRACK!, 12);
    const first = await probe();
    log("probe:", JSON.stringify(first));
    expectThat(
      !!first && !!first.title,
      "the probe reports the song's title from the media session",
    );
    if (first?.artwork) log("artwork host:", new URL(first.artwork).hostname);
    expectThat(
      !!first?.artwork && ownArtwork(first.artwork, description.artworkHosts ?? []),
      "its artwork is on one of BitChord's artwork hosts",
    );
    await js(adapter.playPause!());
    await sleep(1500);
    expectThat((await probe())?.paused === true, "play/pause pauses the song");
    await js(adapter.playPause!());
    await sleep(1500);
    expectThat((await probe())?.paused === false, "play/pause resumes the song");
    const from = (await probe())!.position;
    await js(adapter.seek!(from + 60));
    await sleep(4000);
    const after = (await probe())!.position;
    log(`seek +60 s from ${from}s: now at ${after}s`);
    expectThat(after >= from + 55, `a direct seek sticks (${from}s -> ${after}s)`);

    // Search from the phone (#72): typed text opens the results in the same document, so the song keeps playing,
    // even with BitChord's own search field focused; a second search replaces the results.
    const origin = () => js<number>(`performance.timeOrigin`);
    const resultsFor = (q: string) =>
      js<boolean>(
        `location.pathname === "/search" && new URLSearchParams(location.search).get("q") === ${JSON.stringify(q)} && /songs|artists|albums/i.test(document.querySelector("main")?.innerText ?? "")`,
      );
    const searched = async (q: string) => {
      web.submitSearch(q);
      for (let i = 0; i < 20 && !(await resultsFor(q)); i++) await sleep(500);
      await sleep(1500);
      return resultsFor(q);
    };
    const t0 = await origin();
    const p0 = (await probe())!.position;
    expectThat(await searched("coldplay"), "a search from the phone shows BitChord's results");
    expectThat((await origin()) === t0, "the search kept the same document (no reload)");
    const p1 = await probe();
    log(`search while playing: ${p0}s -> ${p1?.position}s, ${p1?.paused ? "paused" : "playing"}`);
    expectThat(!!p1 && !p1.paused && p1.position > p0, "the song kept playing through the search");
    await js(`document.querySelector('input[aria-label="Search"]')?.focus()`);
    expectThat(
      await js<boolean>(`document.activeElement?.getAttribute("aria-label") === "Search"`),
      "BitChord's search field has focus",
    );
    expectThat(await searched("adele"), "a search with the field focused replaces the results");
    expectThat((await origin()) === t0, "the second search kept the document too");
    expectThat(
      (await probe())?.paused === false,
      "the song was still playing after the second search",
    );
    // The player bar from a long playlist (#73): the ring walks with the page's own keys, as the Remote's Down does.
    const RING_STATE = `(() => {
      const ring = [...document.body.children].find((e) => e.style && e.style.zIndex === "2147483647");
      const bar = document.querySelector('[role="region"][aria-label="Player"]');
      const nav = document.querySelector('nav[aria-label="Main"]');
      if (!ring || ring.style.display === "none" || !bar) return "none";
      const r = ring.getBoundingClientRect(), within = (el) => { const b = el.getBoundingClientRect(); return r.left >= b.left - 6 && r.right <= b.right + 6 && r.top >= b.top - 6 && r.bottom <= b.bottom + 6; };
      if (within(bar)) {
        const on = [...bar.querySelectorAll("button, a")].find((b) => { const q = b.getBoundingClientRect(); return Math.abs(q.left + q.width / 2 - (r.left + r.width / 2)) < 8 && Math.abs(q.top + q.height / 2 - (r.top + r.height / 2)) < 8; });
        return "bar:" + (on ? on.getAttribute("aria-label") ?? on.tagName : "?");
      }
      if (nav && within(nav)) return "sidebar";
      return "page";
    })()`;
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    const FRAMES = process.env.BITCHORD_FRAMES;
    const frame = async (name: string) => {
      if (!FRAMES) return;
      mkdirSync(FRAMES, { recursive: true });
      await js(
        `(() => { const r = [...document.body.children].find((e) => e.style && e.style.zIndex === "2147483647"); if (r) { r.style.transition = "none"; r.getBoundingClientRect(); } })()`,
      );
      wc.invalidate();
      await sleep(500);
      const shot = (await wc.debugger.sendCommand("Page.captureScreenshot", { format: "png" })) as {
        data: string;
      };
      writeFileSync(join(FRAMES, `${name}.png`), Buffer.from(shot.data, "base64"));
      log("frame", name);
    };
    const press = async (k: string) => {
      wc.focus();
      await js(
        `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`,
      );
      await sleep(300);
      return js<string>(RING_STATE);
    };
    const LONG_PLAYLIST =
      process.env.BITCHORD_LONG_PLAYLIST ?? "/playlist/VLPLO7-VO1D0_6MlO4UxJWFBUq3U-7zoIBf7";
    // BitChord's own navigation, so the song keeps playing (a load would stop it): the bar then has Pause to land on.
    const within = async (path: string) => {
      await js(
        `(history.pushState({}, "", ${JSON.stringify(path)}), dispatchEvent(new PopStateEvent("popstate")), 0)`,
      );
      await sleep(4000);
    };
    // From the page's end: Down until the ring is on the bar.
    await within(LONG_PLAYLIST);
    let where = await press("ArrowDown");
    let downs = 1;
    while (!where.startsWith("bar") && downs < 130) {
      where = await press("ArrowDown");
      downs++;
    }
    log(`playlist end: Down reached "${where}" after ${downs} presses`);
    await frame("playlist-down-at-end");
    expectThat(
      /^bar:(Pause|Play)$/.test(where),
      "Down at the end of a 100-song playlist reaches the bar, on Play/Pause",
    );
    // Left and Right walk the bar; Up returns to the page.
    const right = await press("ArrowRight");
    expectThat(right.startsWith("bar") && right !== where, `Right walks the bar (now ${right})`);
    expectThat((await press("ArrowUp")) === "page", "Up from the bar returns to the page");
    // From the middle of the page: Left to the sidebar, then a few Downs.
    await within("/home");
    await within(LONG_PLAYLIST);
    const trail: string[] = [];
    for (let i = 0; i < 12; i++) trail.push(await press("ArrowDown"));
    log("  twelve Downs:", trail.join(" "));
    where = await press("ArrowLeft");
    expectThat(
      where === "sidebar",
      `Left from the middle of the playlist reaches the sidebar (${where})`,
    );
    await frame("playlist-sidebar");
    let sidebarDowns = 0;
    while (where !== "page" && !where.startsWith("bar") && sidebarDowns < 10) {
      where = await press("ArrowDown");
      sidebarDowns++;
    }
    log(`sidebar: Down reached "${where}" after ${sidebarDowns} presses`);
    await frame("playlist-sidebar-to-bar");
    expectThat(
      /^bar:(Pause|Play)$/.test(where) && sidebarDowns <= 7,
      `Left then Down reaches the bar in ${sidebarDowns} presses (at most 7)`,
    );

    // The Remote (#74): the full view and a ⋯ menu, with the host's real keys (a never-shown window needs focus emulation to get them).
    // The ring is Couch's own box in the page: what it is on is the biggest control inside it.
    const ringOn = () =>
      js<string | null>(`(() => {
        const r = [...document.body.children].find((e) => e.style && e.style.zIndex === "2147483647");
        if (!r || r.style.display === "none") return null;
        const b = r.getBoundingClientRect();
        const inside = [...document.querySelectorAll("button, a[href], [role^=menuitem]")]
          .map((e) => ({ e, q: e.getBoundingClientRect() }))
          .filter(({ q }) => q.width && q.height && q.left >= b.left - 8 && q.top >= b.top - 8 && q.right <= b.right + 8 && q.bottom <= b.bottom + 8)
          .sort((x, y) => y.q.width * y.q.height - x.q.width * x.q.height);
        const e = inside[0]?.e;
        return e ? (e.getAttribute("aria-label") || e.innerText || "").trim() : null;
      })()`);
    const sendKey = async (k: "up" | "down" | "left" | "right" | "ok" | "back") => {
      wc.focus();
      web.sendKey(k);
      await sleep(900);
    };
    // BITCHORD_FRAMES=<dir> keeps a frame of each step, with the ring.
    const shoot = async (name: string) => {
      if (!process.env.BITCHORD_FRAMES) return;
      mkdirSync(process.env.BITCHORD_FRAMES, { recursive: true });
      await js(
        `(() => { const r = [...document.body.children].find((e) => e.style && e.style.zIndex === "2147483647"); if (r) { r.style.transition = "none"; r.getBoundingClientRect(); } })()`,
      );
      wc.invalidate();
      await sleep(500);
      const shot = (await wc.debugger.sendCommand("Page.captureScreenshot", { format: "png" })) as {
        data: string;
      };
      writeFileSync(
        join(process.env.BITCHORD_FRAMES, `${name}.png`),
        Buffer.from(shot.data, "base64"),
      );
    };
    const count = (sel: string) =>
      js<number>(
        `[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getBoundingClientRect().width).length`,
      );
    const attached = wc.debugger.isAttached();
    if (!attached) wc.debugger.attach("1.3");
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await within("/home");
    await sleep(1500);
    const startPath = await js<string>(`location.pathname + location.search`);
    // A mouse click of the household's makes the bar's artwork the held control, as reaching it with the D-pad does.
    const art = await js<number[] | null>(`(() => {
      const e = document.querySelector('button[aria-label="Open full screen player"]');
      const q = e?.getBoundingClientRect();
      return q ? [q.left + q.width / 2, q.top + q.height / 2] : null;
    })()`);
    expectThat(!!art, "the player bar has its artwork button while a song plays");
    if (art) {
      const zoom = 1;
      const at = { x: art[0]! * zoom, y: art[1]! * zoom };
      log(
        "artwork at",
        JSON.stringify(art),
        "zoom",
        zoom,
        "inner",
        await js<string>(`innerWidth + "x" + innerHeight + " dpr " + devicePixelRatio`),
      );
      // The D-pad steps above left Couch's shield up; it comes down on a mouse move of more than a few pixels, after one that anchors.
      await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: at.x - 40,
        y: at.y - 40,
      });
      await sleep(300);
      await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
      await sleep(300);
      await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...at,
        button: "left",
        clickCount: 1,
      });
      await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...at,
        button: "left",
        clickCount: 1,
      });
      await sleep(2500);
      expectThat(
        (await count('[role="dialog"][aria-label="Now Playing"]')) === 1,
        "OK on the bar's artwork opens the full view",
      );
      const start = await ringOn();
      log("full view ring on:", start);
      await shoot("1-full-view-start");
      expectThat(start === "Pause", "the ring starts on Pause in the full view");
      await sendKey("up");
      const more = await ringOn();
      expectThat(
        !!more?.startsWith("More options"),
        `Up from Pause reaches the full view's ⋯ (ring on ${more})`,
      );
      await shoot("2-full-view-more");
      await sendKey("ok");
      await shoot("3-menu-open");
      expectThat((await count('[role="menu"]')) === 1, "OK on ⋯ opens BitChord's menu");
      const first = await ringOn();
      expectThat(first === "Play Next", `the ring starts on the menu's first item (${first})`);
      await sendKey("down");
      const second = await ringOn();
      const focused = await js<string>(`(document.activeElement?.innerText ?? "").trim()`);
      log("menu ring on:", second, "focus on:", focused);
      await shoot("4-menu-walked");
      expectThat(
        second === "Add to Queue" && focused === second,
        "Down walks the menu: the ring and BitChord's focus are on the same item",
      );
      await sendKey("back");
      await shoot("5-after-first-back");
      expectThat((await count('[role="menu"]')) === 0, "Back closes the menu");
      expectThat(
        (await count('[role="dialog"][aria-label="Now Playing"]')) === 1,
        "Back with a menu open leaves the full view open",
      );
      expectThat(
        String((await ringOn())?.startsWith("More options")) === "true",
        "the ring is back on the ⋯ that opened the menu",
      );
      await sendKey("back");
      await shoot("6-after-second-back");
      expectThat(
        (await count('[role="dialog"][aria-label="Now Playing"]')) === 0,
        "Back closes the full view",
      );
      expectThat(
        (await ringOn()) === "Open full screen player",
        "the ring is back on the bar's artwork",
      );
      expectThat(
        (await js<string>(`location.pathname + location.search`)) === startPath,
        "the page didn't change",
      );
    }
    if (!attached) wc.debugger.detach();

    const age = await play(AGE_RESTRICTED, 15);
    log("age-restricted log:", age.lines);
    const shown = await js<string>(`document.body.innerText`);
    expectThat(
      /age-restricted[\s\S]*sign in to youtube music/i.test(shown) && age.position < 5,
      `age-restricted ${AGE_RESTRICTED} shows BitChord's sign-in message and does not play`,
    );
  } catch (e) {
    expectThat(false, `check threw: ${String(e)}`);
  }
  log(failures.length ? `FAILED: ${failures.length} check(s)` : "PASSED");
  for (const f of failures) log("  failed:", f);
  web.dispose();
  rmSync(userData, { recursive: true, force: true });
  app.exit(failures.length ? 1 : 0);
});
