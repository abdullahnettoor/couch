// The BitChord real-site check (#52), run by hand: pnpm bitchord:real. Not in CI.
// It loads the live BitChord site through Couch's real BitChord description and web-App host, muted, offscreen and on a
// temp userData (no window is shown, no ports are used, Couch's own data is never touched), then checks that:
//   1. BitChord's Extension page says the extension is installed (and asks for no update),
//   2. a known song from BitChord's /debug page plays past 90 s, and two more for 20 s each,
//   3. an age-restricted song shows BitChord's own sign-in message.
// BITCHORD_SITE overrides the site; BITCHORD_TRACKS=a,b,c and BITCHORD_AGE_RESTRICTED=id override the songs;
// BITCHORD_LONG (seconds, default 90) shortens the long play for a quick look.
import { app, BrowserWindow, session, webContents } from "electron";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bridgeNetwork } from "../src/main/apps/bitchord/bitchord-network.ts";
import { bitchordSite } from "../src/main/apps/bitchord/bitchord-route.ts";
import { BITCHORD_PARTITION, bitchordDescription } from "../src/main/apps/bitchord/bitchord-web.ts";
import { ElectronWebApp } from "../src/main/web/electron-web-app.ts";

const userData = mkdtempSync(join(tmpdir(), "couch-bitchord-check-"));
app.setPath("userData", userData);
app.commandLine.appendSwitch("mute-audio");
app.dock?.hide();

const SITE = bitchordSite(process.env);
const [LONG_TRACK, ...OTHER_TRACKS] = (
  process.env.BITCHORD_TRACKS ?? "ZEcqHA7dbwM,J7p4bzqLvCw,NJAv_7lHUIU"
).split(",");
const AGE_RESTRICTED = process.env.BITCHORD_AGE_RESTRICTED ?? "Tq92D6wQ1mg";
const LONG_SECONDS = Number(process.env.BITCHORD_LONG ?? 90);
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
  const description = bitchordDescription(
    undefined,
    bridgeNetwork((url, init) => ses.fetch(url, init as RequestInit), SITE),
    process.env,
  );
  // A window that is never shown, far off screen. The host asks to reveal it only when it is not "focused and visible", so say it is.
  const win = new BrowserWindow({ show: false, x: -10000, y: -10000, width: 1280, height: 800 });
  const hidden = new Proxy(win, {
    get(target, key) {
      if (key === "isFocused" || key === "isVisible") return () => true;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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
      long.position >= LONG_SECONDS - 5 && long.position >= 1,
      `${LONG_TRACK} played to ${long.position}s (wanted past ${LONG_SECONDS} s)`,
    );
    for (const id of OTHER_TRACKS) {
      const short = await play(id, SHORT_SECONDS);
      expectThat(
        short.position >= SHORT_SECONDS - 5,
        `${id} played to ${short.position}s (wanted ${SHORT_SECONDS} s)`,
      );
    }

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
  web.dispose();
  rmSync(userData, { recursive: true, force: true });
  app.exit(failures.length ? 1 : 0);
});
