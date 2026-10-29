import type { Confirmation, PromptId, TrackKind } from "../../shared/protocol.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import { hiddenScript } from "./hidden-audio.ts";
import { pageFocusFunction } from "./page-focus.ts";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import type { IdleLifecycle } from "./idle-unload.ts";
import type { WebAppDescription } from "./web-app.ts";
import type {
  WebKitBridge,
  WebKitEvent,
  WebKitCookie,
  WebKitFrame,
  WebKitStore,
  WebKitView,
} from "./webkit-bridge.ts";
import { parsePageMessage } from "./webkit-messages.ts";
import { CONFIRM_MESSAGE } from "./web-hud.ts";
import { POLL_MS, WebHostCore } from "./web-host-core.ts";
import { soundScript } from "./web-sound.ts";

/** The one script message handler Couch's own scripts (in the `couch` content world) talk to the host through. */
export const MESSAGE_HANDLER = "couch";

/** What the host needs of Couch's Screen window. */
export interface WebKitHostWindow {
  getContentBounds(): { width: number; height: number };
  onResize(callback: () => void): void;
  /** Brings the Screen window forward; resolves once it is in front. */
  reveal(): Promise<void>;
}

/** Each function runs on its own, so one that throws cannot stop the others. */
export function userScriptSource(funcs: string[]): string {
  return funcs.map((f) => `try { (${f})(); } catch (e) {}`).join("\n");
}

/**
 * WebKit has no console-message event: Couch's own `console.debug("couch:...")` signals (the
 * confirmation's buttons) are forwarded to the message handler instead. It runs in the `couch` world,
 * where Couch's scripts are, so Netflix's own scripts can neither call nor spoof it.
 */
const CONSOLE_FORWARD = `function () {
  var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.${MESSAGE_HANDLER};
  if (!h || console.__couchForward) return;
  console.__couchForward = true;
  var debug = console.debug;
  console.debug = function (m) {
    try { if (typeof m === "string" && m.indexOf("couch:") === 0) h.postMessage({ type: "console", message: m }); } catch (e) {}
    return debug.apply(console, arguments);
  };
}`;

/** Reports the address and the App's own page state to the host, now, on history changes and every 400 ms (main frame only). */
function routeReporter(routeScript: string): string {
  return `function () {
  if (window.top !== window) return;
  var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.${MESSAGE_HANDLER};
  if (!h) return;
  function report() {
    var page = null;
    try { page = (${routeScript}); } catch (e) {}
    try { h.postMessage({ type: "route", url: location.href, page: page }); } catch (e) {}
  }
  setInterval(report, ${POLL_MS});
  addEventListener("popstate", report);
  addEventListener("hashchange", report);
  addEventListener("load", report);
  report();
}`;
}

/**
 * The web-App host on a native `WKWebView` (FairPlay): the same App port as `ElectronWebApp`, the same
 * description, the same shared logic (`WebHostCore`). Couch's scripts and its one message handler live
 * in the `couch` content world; only the page hooks and the App's own preloads run in the page's. Keys are
 * native NSEvents; everything else is `evaluate`.
 */
export class WebKitWebApp implements YouTube {
  #desc: WebAppDescription;
  #bridge: WebKitBridge;
  #win: WebKitHostWindow;
  #store: WebKitStore;
  #lifecycle: IdleLifecycle | undefined;
  #core: WebHostCore;
  #view: WebKitView | undefined;
  #stopEvents: (() => void) | undefined;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #visible = false;
  #failed = false;
  #url = "";
  #volume = 60;
  /** How many buttons the open confirmation has; 0 while none is open. Answers are taken only against this. */
  #confirmButtons = 0;

  constructor(
    desc: WebAppDescription,
    bridge: WebKitBridge,
    win: WebKitHostWindow,
    store: WebKitStore,
    lifecycle?: IdleLifecycle,
  ) {
    this.#desc = desc;
    this.#bridge = bridge;
    this.#win = win;
    this.#store = store;
    this.#lifecycle = lifecycle;
    this.#core = new WebHostCore(
      desc,
      {
        run: (script) =>
          this.#view
            ? this.#view.evaluate(script, { kind: "expression" })
            : Promise.reject(new Error("no view")),
        press: (keyCode) => this.#press(keyCode),
        goBack: () => this.#run("history.back()"),
        url: () => this.#url,
        load: (url) => this.#view?.load(url),
        focus: () => this.#view?.focus(),
        visible: () => this.#visible,
      },
      (event) => this.#emit(event),
      { pollsRoute: false },
    );
    win.onResize(() => this.#fit());
  }

  /** Creates the view, registers its scripts, then loads the App's home. */
  start(): void {
    if (this.#view) return;
    const view = this.#bridge.create({ store: this.#store, userAgent: this.#bridge.userAgent() });
    this.#view = view;
    this.#stopEvents = view.onEvent((event) => this.#onEvent(event));
    view.addMessageHandler(MESSAGE_HANDLER);
    const desc = this.#desc;
    view.addUserScript(
      userScriptSource([PAGE_HOOKS_FUNCTION, ...desc.preloads.map((p) => p.func)]),
      "page",
    );
    view.addUserScript(
      userScriptSource([
        CONSOLE_FORWARD,
        ...(desc.focus ? [pageFocusFunction(desc.focus.selectors, desc.focus.layout)] : []),
        routeReporter(desc.route.script),
      ]),
      "couch",
    );
    view.setVisible(false);
    this.#load();
  }

  #load(): void {
    this.#failed = false;
    this.#view?.load(this.#desc.url);
  }

  #onEvent(event: WebKitEvent): void {
    switch (event.type) {
      case "loaded":
        if (this.#failed || !event.url.startsWith("https:")) return;
        this.#emit({ type: "loaded" });
        if (!this.#visible) this.#run(hiddenScript(true));
        this.#applySound();
        return;
      case "failed":
        this.#failed = true;
        this.#emit({ type: "failed" });
        return;
      case "navigated":
        this.#url = event.url;
        this.#core.navigated(event.url);
        return;
      case "message":
        if (event.name === MESSAGE_HANDLER) this.#onPageMessage(event.body, event.frame);
        return;
    }
  }

  /** Only the App's own main frame is listened to, and only for messages of a known shape. */
  #onPageMessage(body: unknown, frame: WebKitFrame): void {
    if (!frame.isMainFrame || !this.#desc.isOwnOrigin(frame.origin)) return;
    const message = parsePageMessage(body);
    if (message?.type === "route") {
      this.#url = message.url;
      this.#core.setPage(message.page);
      this.#core.navigated(message.url);
    } else if (message?.type === "console") {
      this.#onConsole(message.message);
    }
  }

  #onConsole(text: string): void {
    const pick = CONFIRM_MESSAGE.exec(text);
    if (!pick) return;
    const index = Number(pick[2]);
    // Answers count only while a confirmation is open, and only for one of its buttons.
    if (!Number.isInteger(index) || String(index) !== pick[2] || index >= this.#confirmButtons)
      return;
    this.#emit({ type: "confirm", index, answer: pick[1] === undefined });
  }

  #emit(event: YouTubeEvent): void {
    for (const l of Array.from(this.#listeners)) l(event);
  }

  #run(script: string): void {
    void this.#view?.evaluate(script, { kind: "expression" }).catch(() => {});
  }

  #fit(): void {
    if (!this.#visible || !this.#view) return;
    const { width, height } = this.#win.getContentBounds();
    this.#view.setFrame(0, 0, width, height);
  }

  show(_note?: string): void {
    if (!this.#view) this.start();
    const view = this.#view!;
    this.#lifecycle?.shown();
    this.#visible = true;
    this.#core.shown();
    this.#fit();
    view.setVisible(true);
    this.#run(hiddenScript(false));
    this.#applySound();
    void this.#win.reveal().then(() => view.focus());
  }

  hide(): void {
    this.#visible = false;
    this.#confirmButtons = 0;
    this.#core.hidden();
    this.#view?.setVisible(false);
    this.#applySound();
    this.#run(hiddenScript(true));
    this.#lifecycle?.hidden();
  }

  /** Drops the loaded page (the data store stays on disk); the next `show()` loads the App again at its home. */
  unload(): void {
    if (this.#visible || !this.#view) return;
    this.#stopEvents?.();
    this.#view.destroy();
    this.#view = undefined;
    this.#failed = false;
    this.#url = "";
    this.#confirmButtons = 0;
    this.#core.reset();
  }

  /** Puts cookies in this App's store and loads its home again, so the page sees them. */
  async setCookies(cookies: WebKitCookie[]): Promise<void> {
    if (!this.#view) this.start();
    const view = this.#view!;
    await view.setCookies(cookies);
    if (this.#view === view) this.#load();
  }

  /**
   * Forgets the sign-in: the view goes first (WebKit refuses to remove a store a view uses), then the store.
   * Once the store is gone the page loads again from scratch, so the sign-in page is up straight away; a view
   * that was on screen comes back on screen, one that was never loaded stays unloaded.
   */
  async signOut(): Promise<void> {
    const wasVisible = this.#visible;
    const wasLoaded = !!this.#view;
    if (wasVisible) this.hide();
    this.unload();
    if (!this.#store.ephemeral) await this.#bridge.removeStore(this.#store.id);
    if (!wasLoaded) return;
    this.start();
    if (wasVisible) this.show();
  }

  restart(): void {
    if (!this.#view) return this.start();
    this.#load();
  }

  focus(): void {
    this.#view?.focus();
  }

  /** Part of the host seam: WebKit keys are not seen by Electron's input events yet (ticket 112). */
  setKeyGate(_gate: unknown): void {}

  seekTo(seconds: number): void {
    this.#core.seekTo(seconds);
  }

  pressPrompt(id: PromptId): void {
    this.#core.pressPrompt(id);
  }

  setSpeed(speed: number): void {
    this.#core.setSpeed(speed);
  }

  setTrack(kind: TrackKind, id: string): void {
    this.#core.setTrack(kind, id);
  }

  sendKey(key: YouTubeKey): void {
    this.#core.sendKey(key);
  }

  #press(keyCode: string): void {
    const view = this.#view;
    if (!view) return;
    view.sendKey(keyCode, true);
    view.sendKey(keyCode, false);
  }

  scrollToTop(): void {
    this.#core.scrollToTop();
  }

  playPause(): void {
    this.#core.playPause();
  }

  seekBy(seconds: number): void {
    this.#core.seekBy(seconds);
  }

  /** The Mac keyboard doesn't reach a WebKit view through Electron's events yet (ticket 112). */
  captureText(_on: boolean): void {}

  submitSearch(text: string): void {
    this.#core.submitSearch(text);
  }

  showSearchBar(text: string | undefined): void {
    this.#core.showSearchBar(text);
  }

  /** Couch's own screen draws the volume level over a native view (ticket 111 checks it). */
  showVolume(_percent: number | undefined): void {}

  /** Couch's screen draws the confirmation (ticket 111); the host only remembers that one is open, to judge answers. */
  showConfirm(confirm: Confirmation | undefined): void {
    this.#confirmButtons = confirm ? confirm.buttons.length : 0;
  }

  setVolume(percent: number): void {
    this.#volume = percent;
    this.#applySound();
  }

  /** A hidden App is silent: its media is at volume 0 (and paused) whatever Couch's volume is. */
  #applySound(): void {
    this.#run(soundScript(this.#visible ? this.#volume : 0, "", false));
  }

  /**
   * WebKit lists no `audiooutput` ids without a capture grant (which would ask the household for the
   * microphone), and `setSinkId` takes only those ids, so Netflix plays to the Mac's current output.
   * Asking for a device is accepted quietly; Sound output shows the note instead of a failure.
   */
  readonly followsMacOutput = true;

  async setOutputDevice(_name: string | undefined): Promise<boolean> {
    return true;
  }

  /** Not supported yet (WebKit's add-ons need user scripts that can be removed): reloads in place. */
  setAddons(_ids: string[], _note?: string): void {
    if (this.#url.startsWith("https:")) this.#load();
  }

  onEvent(listener: (event: YouTubeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}
