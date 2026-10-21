import { confirmScript, noteScript, searchBarScript, volumeScript } from "./youtube-hud.ts";
import { RouteTracker, PAGE_STATE_SCRIPT, type PageState } from "./youtube-route.ts";
import type { Confirmation } from "../../shared/protocol.ts";
import { join } from "node:path";
import { app, BrowserWindow, WebContentsView, clipboard, session } from "electron";
import { SCREEN_KEYS, textEditFor } from "../../shared/keyboard.ts";
import { revealScreen } from "../reveal.ts";
import {
  LIST_OUTPUTS_SCRIPT,
  pickOutputId,
  soundScript,
  type PageOutput,
} from "./youtube-sound.ts";
import { applyCompatPatch } from "./youtube-compat.ts";
import { CONTROLS_HIDE_MS, SKIP_COMMIT_MS, skipKeys } from "./youtube-skip.ts";
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

export function isSearchUrl(url: string): boolean {
  return /#\/search\b/.test(url);
}

/** The YouTube port in Electron: one persistent, always-loaded view over the Screen window. */
export class ElectronYouTube implements YouTube {
  #win: BrowserWindow;
  #view: WebContentsView;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #visible = false;
  #failed = false;
  #sending = false;
  #capturing = false;
  #inSearch = false;
  #skipTimer: ReturnType<typeof setTimeout> | undefined;
  #lastSkipAt = 0;
  #page: PageState = { shorts: false, guide: false };
  #routes = new RouteTracker();
  #routeTimer: ReturnType<typeof setInterval> | undefined;
  #volume = 60;
  #sinkId = "";

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
    // The view may ask the Mac for nothing (no microphone, no camera). Its media permission *check*
    // is answered yes only so the page can read output names (labels), to pick one for setSinkId.
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler((_wc, permission, origin) => {
      return permission === "media" && /^https:\/\/www\.youtube\.com\/?/.test(origin);
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
      this.#syncRoute();
    });
    // A new document has none of Couch's volume or output yet.
    wc.on("dom-ready", () => this.#applySound());
    wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.#failed = true;
      this.#emit({ type: "failed" });
    });
    wc.on("before-input-event", (event, input) => {
      if (this.#sending) return;
      if (this.#capturing) {
        event.preventDefault();
        if (input.type !== "keyDown") return;
        const edit = textEditFor({
          key: input.key,
          meta: input.meta,
          ctrl: input.control,
          alt: input.alt,
        });
        if (edit && "paste" in edit) {
          void Promise.resolve(clipboard.readText()).then((text) => {
            if (text) this.#emit({ type: "edit", edit: { insert: text } });
          });
          return;
        }
        if (edit) this.#emit({ type: "edit", edit });
        return;
      }
      if (input.type === "keyDown" && !input.control && !input.alt) {
        const find = input.meta ? input.key.toLowerCase() === "f" : input.key === "/";
        if (find) {
          event.preventDefault();
          this.#emit({ type: "find" });
          return;
        }
      }
      const command = SCREEN_KEYS[input.key];
      if (!command || input.control || input.meta || input.alt) return;
      event.preventDefault();
      if (input.type === "keyDown") this.#emit({ type: "key", command });
    });
    const route = (_e: unknown, url: string) => {
      if (!url.startsWith("https:")) return;
      this.#syncRoute();
      const entering = isSearchUrl(url) && !this.#inSearch;
      this.#inSearch = isSearchUrl(url);
      // Only arriving at search counts; Couch's own query updates also change the route.
      if (entering) setTimeout(() => this.#emit({ type: "searchOpened" }), 400);
    };
    wc.on("did-navigate", route);
    wc.on("did-navigate-in-page", route);
  }

  /** Tells the core whether YouTube is on its home screen (a Short keeps Home's URL, so the page is asked too). */
  #syncRoute(): void {
    const route = this.#routes.update(this.#view.webContents.getURL(), this.#page);
    if (route) this.#emit({ type: "route", ...route });
  }

  #pollShorts(): void {
    void this.#view.webContents
      .executeJavaScript(PAGE_STATE_SCRIPT)
      .then((page: PageState) => {
        this.#page = page;
        this.#syncRoute();
      })
      .catch(() => {});
  }

  /** Starts loading in the background so opening YouTube is instant. */
  start(): void {
    const wc = this.#view.webContents;
    // DevTools commands only answer once the view has a renderer, so give it a blank page first.
    void wc
      .loadURL("about:blank")
      .catch(() => {})
      // The identity must never hold YouTube back; load anyway if DevTools doesn't answer.
      .then(() => Promise.race([applyIdentity(wc), new Promise((r) => setTimeout(r, 3000))]))
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
    this.#routeTimer ??= setInterval(() => this.#pollShorts(), 400);
    this.#fit();
    this.#view.setVisible(true);
    void revealScreen(this.#win).then(() => this.#view.webContents.focus());
    if (note) void this.#showNote(note);
  }

  hide(): void {
    this.#visible = false;
    clearInterval(this.#routeTimer);
    this.#routeTimer = undefined;
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
    void this.#view.webContents.executeJavaScript(volumeScript(percent)).catch(() => {});
  }

  setVolume(percent: number): void {
    this.#volume = percent;
    this.#applySound();
  }

  #applySound(): void {
    void this.#view.webContents
      .executeJavaScript(soundScript(this.#volume, this.#sinkId))
      .catch(() => {});
  }

  async setOutputDevice(name: string | undefined): Promise<boolean> {
    if (name === undefined) {
      this.#sinkId = "";
      this.#applySound();
      return true;
    }
    try {
      const outputs = (await this.#view.webContents.executeJavaScript(
        LIST_OUTPUTS_SCRIPT,
      )) as PageOutput[];
      const id = pickOutputId(name, outputs);
      this.#sinkId = id ?? "";
      this.#applySound();
      return id !== undefined;
    } catch {
      this.#sinkId = "";
      this.#applySound();
      return false;
    }
  }

  async #showNote(note: string): Promise<void> {
    await this.#view.webContents.executeJavaScript(noteScript(note)).catch(() => {});
  }

  showConfirm(confirm: Confirmation | undefined): void {
    void this.#view.webContents.executeJavaScript(confirmScript(confirm)).catch(() => {});
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

  /**
   * Skips by driving YouTube's own scrubber with keys (Left/Right, then OK after the last press).
   * j/l, media fast-forward keys and bare arrows do not seek in the TV player.
   */
  seekBy(seconds: number): void {
    const now = Date.now();
    for (const key of skipKeys(seconds, now - this.#lastSkipAt < CONTROLS_HIDE_MS))
      this.sendKey(key);
    this.#lastSkipAt = now;
    clearTimeout(this.#skipTimer);
    this.#skipTimer = setTimeout(() => {
      this.sendKey("ok");
      this.#lastSkipAt = 0;
    }, SKIP_COMMIT_MS);
  }

  captureText(on: boolean): void {
    this.#capturing = on;
  }

  submitSearch(text: string): void {
    // Going to search is Couch's own doing, not the household opening YouTube's search screen.
    this.#inSearch = true;
    this.#goToSearch(text);
    this.#view.webContents.focus();
  }

  showSearchBar(text: string | undefined): void {
    void this.#view.webContents.executeJavaScript(searchBarScript(text)).catch(() => {});
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
