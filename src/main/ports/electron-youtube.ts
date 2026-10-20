import { join } from "node:path";
import { app, BrowserWindow, WebContentsView, session } from "electron";
import { SCREEN_KEYS } from "../../shared/keyboard.ts";
import { applyCompatPatch } from "./youtube-compat.ts";
import { applyToRequestHeaders, buildIdentity } from "./youtube-identity.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "./youtube.ts";

export const YOUTUBE_URL = "https://www.youtube.com/tv";
/** The Cobalt TV identity from the feasibility research; plain Chrome UAs get a "going to youtube.com" page. */
const IDENTITY = buildIdentity(app.getVersion());
export const COBALT_USER_AGENT = IDENTITY.userAgent;
const PARTITION = "persist:youtube";

const KEY_CODES: Record<YouTubeKey, string> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  ok: "Return",
  back: "Escape",
};

export const SEARCH_URL = "https://www.youtube.com/tv#/search";

/** YouTube TV's own search deep link: it fills the search box and shows results for the text. */
export function searchUrlFor(text: string): string {
  const q = text.trim();
  return q ? `${SEARCH_URL}?q=${encodeURIComponent(q)}` : SEARCH_URL;
}

/** Live text waits for a pause in typing so YouTube isn't asked for results on every letter. */
const TYPING_SETTLE_MS = 350;

export function isSearchUrl(url: string): boolean {
  return /#\/search\b/.test(url);
}

/** YouTube's home and browse screens; anything else (watch, search, settings...) is deeper. */
export function isTopLevelUrl(url: string): boolean {
  const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
  return (
    hash === "" || hash === "#" || /^#\/?(\?.*)?$/.test(hash) || /^#\/(browse|home)\b/.test(hash)
  );
}

/** The YouTube port in Electron: one persistent, always-loaded view over the Screen window. */
export class ElectronYouTube implements YouTube {
  #win: BrowserWindow;
  #view: WebContentsView;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #visible = false;
  #failed = false;
  #sending = false;
  #inSearch = false;
  #query = "";
  #typingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(win: BrowserWindow) {
    this.#win = win;
    const ses = session.fromPartition(PARTITION);
    app.userAgentFallback = COBALT_USER_AGENT;
    ses.setUserAgent(COBALT_USER_AGENT);
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: applyToRequestHeaders(
          IDENTITY,
          new URL(details.url),
          details.requestHeaders,
        ),
      });
    });
    applyCompatPatch(ses, join(app.getPath("userData"), "youtube"));
    this.#view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    this.#view.setVisible(false);
    win.contentView.addChildView(this.#view);
    win.on("resize", () => this.#fit());

    const wc = this.#view.webContents;
    wc.setUserAgent(COBALT_USER_AGENT);
    wc.on("did-finish-load", () => {
      if (this.#failed || !wc.getURL().startsWith("https:")) return;
      this.#emit({ type: "loaded" });
      this.#emit({ type: "route", topLevel: isTopLevelUrl(wc.getURL()) });
    });
    wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.#failed = true;
      this.#emit({ type: "failed" });
    });
    wc.on("before-input-event", (event, input) => {
      if (this.#sending) return;
      const command = SCREEN_KEYS[input.key];
      if (!command || input.control || input.meta || input.alt) return;
      event.preventDefault();
      if (input.type === "keyDown") this.#emit({ type: "key", command });
    });
    const route = (_e: unknown, url: string) => {
      if (!url.startsWith("https:")) return;
      this.#emit({ type: "route", topLevel: isTopLevelUrl(url) });
      const entering = isSearchUrl(url) && !this.#inSearch;
      this.#inSearch = isSearchUrl(url);
      // Only arriving at search counts; Couch's own query updates also change the route.
      if (entering) setTimeout(() => this.#emit({ type: "searchOpened" }), 400);
    };
    wc.on("did-navigate", route);
    wc.on("did-navigate-in-page", route);
  }

  /** Starts loading in the background so opening YouTube is instant. */
  start(): void {
    const wc = this.#view.webContents;
    // DevTools commands only answer once the view has a renderer, so give it a blank page first.
    void wc
      .loadURL("about:blank")
      .catch(() => {})
      .then(() => applyIdentity(wc))
      .then(() => this.#load());
  }

  #load(): void {
    this.#failed = false;
    void this.#view.webContents
      .loadURL(YOUTUBE_URL, { userAgent: COBALT_USER_AGENT })
      .catch(() => {});
  }

  #emit(event: YouTubeEvent): void {
    for (const l of [...this.#listeners]) l(event);
  }

  #fit(): void {
    if (!this.#visible) return;
    const { width, height } = this.#win.getContentBounds();
    this.#view.setBounds({ x: 0, y: 0, width, height });
  }

  show(note?: string): void {
    this.#visible = true;
    this.#fit();
    this.#view.setVisible(true);
    this.#view.webContents.focus();
    if (note) void this.#showNote(note);
  }

  hide(): void {
    this.#visible = false;
    this.#pause();
    this.#view.setVisible(false);
    this.#win.webContents.focus();
  }

  #pause(): void {
    void this.#view.webContents
      .executeJavaScript("document.querySelectorAll('video').forEach(function(v){v.pause()})")
      .catch(() => {});
  }

  showVolume(percent: number | undefined): void {
    const js =
      percent === undefined
        ? `var e=document.getElementById('couch-volume');if(e)e.remove()`
        : `(function(){var d=document.getElementById('couch-volume');if(!d){d=document.createElement('div');d.id='couch-volume';` +
          `d.style.cssText='position:fixed;right:48px;top:40px;z-index:2147483647;padding:10px 22px;border-radius:12px;` +
          `background:rgba(20,18,16,.9);color:#f3ede4;font:600 26px system-ui;pointer-events:none';document.body.appendChild(d)}` +
          `d.textContent='Volume ${Math.round(percent)}%'})()`;
    void this.#view.webContents.executeJavaScript(js).catch(() => {});
  }

  async #showNote(note: string): Promise<void> {
    const text = JSON.stringify(note);
    await this.#view.webContents
      .executeJavaScript(
        `(function(){var d=document.createElement('div');d.textContent=${text};` +
          `d.style.cssText='position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:2147483647;` +
          `padding:14px 28px;border-radius:14px;background:rgba(20,18,16,.9);color:#f3ede4;font:600 28px system-ui;pointer-events:none';` +
          `document.body.appendChild(d);setTimeout(function(){d.remove()},4000)})()`,
      )
      .catch(() => {});
  }

  sendKey(key: YouTubeKey): void {
    const keyCode = KEY_CODES[key];
    const wc = this.#view.webContents;
    this.#sending = true;
    try {
      wc.sendInputEvent({ type: "keyDown", keyCode });
      wc.sendInputEvent({ type: "keyUp", keyCode });
    } finally {
      this.#sending = false;
    }
  }

  playPause(): void {
    const wc = this.#view.webContents;
    wc.sendInputEvent({ type: "keyDown", keyCode: "MediaPlayPause" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "MediaPlayPause" });
  }

  openSearch(): void {
    this.#query = "";
    if (!isSearchUrl(this.#view.webContents.getURL())) this.#goToSearch("");
  }

  /** Mirrors the phone's text through YouTube's search link; no page content is read or edited. */
  setSearchText(text: string): void {
    this.#query = text;
    clearTimeout(this.#typingTimer);
    this.#typingTimer = setTimeout(() => this.#goToSearch(this.#query), TYPING_SETTLE_MS);
  }

  submitSearch(): void {
    clearTimeout(this.#typingTimer);
    this.#goToSearch(this.#query);
    this.#view.webContents.focus();
  }

  #goToSearch(text: string): void {
    const wc = this.#view.webContents;
    const url = searchUrlFor(text);
    if (wc.getURL() === url) return;
    void wc.loadURL(url, { userAgent: COBALT_USER_AGENT }).catch(() => {});
  }

  restart(): void {
    this.#load();
  }

  onEvent(listener: (event: YouTubeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

/** Makes navigator.userAgent / userAgentData match the Cobalt identity, in the page and its iframes. */
async function applyIdentity(wc: Electron.WebContents): Promise<void> {
  const dbg = wc.debugger;
  const override = { userAgent: IDENTITY.userAgent, userAgentMetadata: IDENTITY.metadata };
  try {
    if (!dbg.isAttached()) dbg.attach("1.3");
    dbg.on("message", (_e, method, params: any) => {
      if (method !== "Target.attachedToTarget") return;
      void (async () => {
        const { sessionId, targetInfo, waitingForDebugger } = params;
        try {
          if (targetInfo.type === "iframe") {
            await dbg.sendCommand("Emulation.setUserAgentOverride", override, sessionId);
            await dbg.sendCommand("Target.setAutoAttach", AUTO_ATTACH, sessionId);
          }
        } catch {
        } finally {
          if (waitingForDebugger)
            dbg.sendCommand("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
        }
      })();
    });
    await dbg.sendCommand("Emulation.setUserAgentOverride", override);
    await dbg.sendCommand("Target.setAutoAttach", AUTO_ATTACH);
  } catch (error) {
    console.warn(`[youtube] could not apply client-hint identity: ${String(error)}`);
  }
}
