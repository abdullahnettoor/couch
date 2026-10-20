import { BrowserWindow, WebContentsView, session } from "electron";
import type { CommandName } from "../../shared/protocol.ts";
import { applyCompatPatch } from "./youtube-compat.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "./youtube.ts";

export const YOUTUBE_URL = "https://www.youtube.com/tv";
/** The Cobalt TV identity from the feasibility research; plain Chrome UAs get a "going to youtube.com" page. */
export const COBALT_USER_AGENT = "Mozilla/5.0 Cobalt/25 (Sony, PS4, Wired)";
const PARTITION = "persist:youtube";

const KEY_CODES: Record<YouTubeKey, string> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  ok: "Return",
  back: "Escape",
};

/** Mac keyboard keys that drive YouTube through the core, like on the Screen. */
const KEYBOARD: Record<string, CommandName> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "ok",
  Escape: "back",
  Backspace: "back",
  h: "home",
  H: "home",
  " ": "playpause",
};

export const SEARCH_URL = "https://www.youtube.com/tv#/search";

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

  constructor(win: BrowserWindow) {
    this.#win = win;
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(COBALT_USER_AGENT);
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
      if (this.#failed) return;
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
      const command = KEYBOARD[input.key];
      if (!command || input.control || input.meta || input.alt) return;
      event.preventDefault();
      if (input.type === "keyDown") this.#emit({ type: "key", command });
    });
    const route = (_e: unknown, url: string) => {
      this.#emit({ type: "route", topLevel: isTopLevelUrl(url) });
      // Give the search screen a moment to draw before text is replayed into it.
      if (isSearchUrl(url)) setTimeout(() => this.#emit({ type: "searchOpened" }), 400);
    };
    wc.on("did-navigate", route);
    wc.on("did-navigate-in-page", route);
  }

  /** Starts loading in the background so opening YouTube is instant. */
  start(): void {
    void applyCompatPatch(this.#view.webContents).then(() => this.#load());
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
    const wc = this.#view.webContents;
    if (isSearchUrl(wc.getURL())) return;
    void wc.loadURL(SEARCH_URL, { userAgent: COBALT_USER_AGENT }).catch(() => {});
  }

  /**
   * Replaces the search box text with trusted editing events (no page reads). Does nothing until
   * the search screen is showing; the core replays the text when it reports `searchOpened`.
   */
  setSearchText(text: string): void {
    const wc = this.#view.webContents;
    if (!isSearchUrl(wc.getURL()) || wc.isLoading()) return;
    wc.focus();
    wc.selectAll();
    if (text) wc.insertText(text);
    else this.sendKey("back");
  }

  submitSearch(): void {
    this.sendKey("ok");
  }

  restart(): void {
    this.#load();
  }

  onEvent(listener: (event: YouTubeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}
