// PROTOTYPE (throwaway, do not merge): can Couch stand in for BitChord's browser extension, so the real BitChord
// web player runs unchanged inside Couch?
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/PROTOTYPE-bitchord/main.mts            (a window)
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/PROTOTYPE-bitchord/main.mts --auto     (muted test)
// It loads the hosted site, answers its bridge (web/shared/src/bridge in BitChord, protocol 1) through the page-relay
// transport its Firefox build uses, and does the extension's header work (web/extension/lib/rules.ts) with the
// session's webRequest hooks. Signed out only. State lives in memory (no persist: partition).
import { app, BrowserWindow, ipcMain, session } from "electron";
import { join } from "node:path";

const SITE = process.env.BITCHORD_SITE ?? "https://bitchord-8bw.pages.dev";
const AUTO = process.argv.includes("--auto");
/** --auto plays each of these on the site's /debug page; the first plays long enough to pass BitChord's ~70 s wall. */
const TRACKS = (process.env.BITCHORD_TRACKS ?? "ZEcqHA7dbwM,J7p4bzqLvCw,NJAv_7lHUIU,Tq92D6wQ1mg").split(",");
const LONG_SECONDS = Number(process.env.BITCHORD_LONG ?? 90);
const SHORT_SECONDS = 20;

const log = (...a: unknown[]) => console.log("[bitchord]", ...a);

// ---- The extension's header rules (rules.ts 1–7), on this session only ----------------------------------------
function rulesFor(url: string): { set?: Record<string, string>; remove?: string[]; cors: boolean } | null {
  const u = new URL(url);
  const yt = (o: string) => ({ Origin: o, Referer: `${o}/`, "X-Origin": o });
  if (u.hostname === "music.youtube.com" && u.pathname.startsWith("/youtubei/"))
    return { set: yt("https://music.youtube.com"), cors: true };
  if (u.hostname === "www.youtube.com" && u.pathname.startsWith("/youtubei/"))
    return { set: yt("https://www.youtube.com"), cors: true };
  if (u.hostname === "www.youtube.com" && /^\/(sw\.js_data|iframe_api|s\/player\/)/.test(u.pathname)) return { cors: true };
  if (u.hostname.endsWith("googlevideo.com")) {
    if (u.searchParams.get("c") === "VISIONOS") return { remove: ["Origin", "Referer"], cors: true };
    return { set: { Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/" }, cors: true };
  }
  return null;
}

function installRules(ses: Electron.Session) {
  ses.webRequest.onBeforeSendHeaders((details, done) => {
    const rule = rulesFor(details.url);
    if (!rule) return done({});
    const headers = { ...details.requestHeaders };
    for (const name of rule.remove ?? [])
      for (const k of Object.keys(headers)) if (k.toLowerCase() === name.toLowerCase()) delete headers[k];
    for (const [k, v] of Object.entries(rule.set ?? {})) {
      for (const h of Object.keys(headers)) if (h.toLowerCase() === k.toLowerCase()) delete headers[h];
      headers[k] = v;
    }
    done({ requestHeaders: headers });
  });
  ses.webRequest.onHeadersReceived((details, done) => {
    const rule = rulesFor(details.url);
    if (!rule?.cors) return done({});
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers))
      if (/^access-control-allow-origin$|^access-control-expose-headers$/i.test(k)) delete headers[k];
    headers["Access-Control-Allow-Origin"] = ["*"];
    headers["Access-Control-Expose-Headers"] = ["*"];
    done({ responseHeaders: headers });
  });
}

// ---- The bridge (background.ts handle(), signed-out subset) ----------------------------------------------------
const SIGNED_OUT = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};
const calls = new Map<string, number>();

async function serialise(r: Response) {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  const textual = /json|text|javascript|xml/.test(r.headers.get("content-type") ?? "");
  return {
    status: r.status,
    headers,
    url: r.url,
    bodyEncoding: textual ? "text" : "base64",
    body: textual ? await r.text() : Buffer.from(await r.arrayBuffer()).toString("base64"),
  };
}

async function plainFetch(ses: Electron.Session, p: any) {
  const body = p.body === undefined ? undefined : p.bodyEncoding === "base64" ? Buffer.from(p.body, "base64") : p.body;
  return serialise(await ses.fetch(p.url, { method: p.method ?? "GET", headers: p.headers ?? {}, body, credentials: "omit" } as any));
}

async function handle(ses: Electron.Session, req: any): Promise<unknown> {
  const ok = (result: unknown) => ({ ok: true, result });
  const err = (code: string, message: string) => ({ ok: false, error: { code, message } });
  switch (req.method) {
    case "ping":
      return ok({ version: "0.4.4", protocol: 1, browser: "chromium", capabilities: ["yt", "lyrics"] });
    case "yt.authState":
      return ok(SIGNED_OUT);
    case "yt.fetch":
      if (req.params.auth) return err("unauthenticated", "Couch prototype: signed out only.");
      if (!/^https:\/\/www\.youtube\.com\/api\/jnn\//.test(req.params.url)) return err("forbidden", "not served");
      // BotGuard's GenerateIT wants YouTube's Origin (rules.ts installExtensionFetchRule); the session hook can't
      // tell this request from the page's own, so set it here.
      return ok(
        await plainFetch(ses, {
          ...req.params,
          headers: { ...req.params.headers, Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/" },
        }),
      );
    case "lyrics.fetch":
      return ok(await plainFetch(ses, req.params));
    case "lyrics.permissions":
      return ok({ granted: req.params.origins ?? [] });
    default:
      return err("unsupported", `${req.method} isn't in the Couch prototype.`);
  }
}

// ---- Window ---------------------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  const ses = session.fromPartition("prototype-bitchord");
  installRules(ses);

  ipcMain.handle("bitchord-bridge", async (_e, req) => {
    calls.set(req.method, (calls.get(req.method) ?? 0) + 1);
    try {
      const res: any = await handle(ses, req);
      if (!res.ok || req.method !== "yt.fetch") log(req.method, res.ok ? "ok" : res.error.code);
      else log(req.method, new URL(req.params.url).pathname, res.result.status);
      return { channel: "bitchord-bridge", protocol: 1, direction: "to-page", id: req.id, ...res };
    } catch (e) {
      log(req.method, "threw", String(e));
      return {
        channel: "bitchord-bridge",
        protocol: 1,
        direction: "to-page",
        id: req.id,
        ok: false,
        error: { code: "network", message: String(e) },
      };
    }
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !AUTO,
    title: "PROTOTYPE · BitChord in Couch",
    webPreferences: {
      session: ses,
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (AUTO) win.webContents.setAudioMuted(true);
  win.webContents.on("console-message", (e: any) => {
    const text = e.message ?? "";
    if (/error|fail|refus|bridge|extension/i.test(text)) log("page:", text.slice(0, 300));
  });

  await win.loadURL(`${SITE}/extension`);
  if (!AUTO) return;

  const js = (code: string) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await sleep(6000);
  const status = await js(`document.querySelector("main")?.innerText.slice(0, 400) ?? document.body.innerText.slice(0, 400)`);
  log("Extension page says:", JSON.stringify(status));

  const results: Array<Record<string, unknown>> = [];
  for (const [i, id] of TRACKS.entries()) {
    await win.loadURL(`${SITE}/debug`);
    await sleep(3000);
    // The player's media element needn't be in the DOM; catch it when it plays.
    await js(`(() => {
      window.__media = new Set();
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { window.__media.add(this); return play.call(this); };
    })()`);
    await js(`(() => {
      const input = document.querySelector("form input");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, ${JSON.stringify(id)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form.requestSubmit();
    })()`);
    const seconds = i === 0 ? LONG_SECONDS : SHORT_SECONDS;
    let last = { t: 0, paused: true, src: "" as string, error: null as unknown };
    for (let s = 0; s < seconds; s += 5) {
      await sleep(5000);
      last = await js(`(() => {
        const m = [...window.__media, ...document.querySelectorAll("audio,video")].sort((a, b) => b.currentTime - a.currentTime)[0];
        return m ? { t: Math.round(m.currentTime), paused: m.paused, src: m.currentSrc.slice(0, 30), error: m.error?.code ?? null } : { t: 0, paused: true, src: "", error: "no media element" };
      })()`);
      log(`  ${id} +${s + 5}s position ${last.t}s ${last.paused ? "paused" : "playing"}`);
    }
    const lines = await js(`document.querySelector("main")?.innerText.split("\\n").filter(l => /${id}|refus|error|age|sign in|client|VISIONOS|WEB/i.test(l)).slice(-6).join(" | ") ?? ""`);
    results.push({ id, position: last.t, playing: !last.paused, mediaError: last.error, log: lines });
  }
  log("RESULT", JSON.stringify({ site: SITE, bridgeCalls: Object.fromEntries(calls), tracks: results }, null, 2));
  app.quit();
});
