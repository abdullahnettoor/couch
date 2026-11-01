import { MEDIA_TOGGLE_SCRIPT } from "./media-toggle.ts";
import type { Confirmation, PromptId, TrackKind } from "../../shared/protocol.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import { FIELD_BLURRED, FIELD_FOCUSED, FIELD_FOCUSED_QUERY } from "./page-focus.ts";
import { hiddenScript } from "./hidden-audio.ts";
import { pageFocusFunction } from "./page-focus.ts";
import type { KeyGate } from "./keyboard-policy.ts";
import { WebKitKeyboard } from "./webkit-keyboard.ts";
import { KEY_CLAIM_FUNCTION, PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import type { IdleLifecycle } from "./idle-unload.ts";
import type { WebAppDescription } from "./web-app.ts";
import type {
  WebKitBridge,
  WebKitEvent,
  WebKitCookie,
  WebKitFrame,
  WebKitKey,
  WebKitStore,
  WebKitView,
} from "./webkit-bridge.ts";
import { MESSAGE_HANDLER_NAME, parsePageMessage } from "./webkit-messages.ts";
import { COUCH_HOST_WEBKIT, MOUSE_INPUT_REPORTER } from "./couch-host.ts";
import { HIDE_SCROLLBARS_SCRIPT } from "./hide-scrollbars.ts";
import { CONFIRM_MESSAGE, noteScript } from "./web-hud.ts";
import { POLL_MS, WebHostCore } from "./web-host-core.ts";
import { soundScript } from "./web-sound.ts";

/** The one script message handler Couch's own scripts (in the `couch` content world) talk to the host through. */
export const MESSAGE_HANDLER = MESSAGE_HANDLER_NAME;

/** What the host needs of Couch's Screen window. */
export interface WebKitHostWindow {
  /** The text on the clipboard, for ⌘V while Couch is capturing typed text. */
  readClipboard?(): string | Promise<string>;
  getContentBounds(): { width: number; height: number };
  onResize(callback: () => void): (() => void) | void;
  /** Brings the Screen window forward; resolves once it is in front. */
  reveal(): Promise<void>;
  /** Gives Couch's own page the keyboard (a hidden WebKit view would otherwise keep first responder). */
  focusScreen?(): void;
}

/** Each function runs on its own, so one that throws cannot stop the others. */
export function userScriptSource(funcs: string[]): string {
  return funcs.map((f) => `try { (${f})(); } catch (e) {}`).join("\n");
}

/**
 * WebKit has no console-message event: Couch's own `console.debug("couch:...")` signals (the confirmation's buttons,
 * a field taking focus) are forwarded through `couchHost.send`. It runs in the `couch` world, where Couch's scripts are,
 * so Netflix's own scripts can neither call nor spoof it.
 */
const CONSOLE_FORWARD = `function () {
  if (!window.couchHost || console.__couchForward) return;
  console.__couchForward = true;
  var debug = console.debug;
  console.debug = function (m) {
    try { if (typeof m === "string" && m.indexOf("couch:") === 0) window.couchHost.send({ type: "console", message: m }); } catch (e) {}
    return debug.apply(console, arguments);
  };
}`;

/** Reports the address and the App's own page state to the host, now, on history changes and every 400 ms (main frame only). */
function routeReporter(routeScript: string): string {
  return `function () {
  if (window.top !== window) return;
  if (!window.couchHost) return;
  function report() {
    var page = null;
    try { page = (${routeScript}); } catch (e) {}
    try { window.couchHost.send({ type: "route", url: location.href, page: page }); } catch (e) {}
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
  #showGeneration = 0;
  #failed = false;
  #url = "";
  #volume = 60;
  /** How many buttons the open confirmation has; 0 while none is open. Answers are taken only against this. */
  #confirmButtons = 0;
  #loaded = false;
  /** A note asked for while the page was still loading; it is drawn when the page has loaded. */
  #pendingNote: string | undefined;
  #keyGate: KeyGate | undefined;
  #keyboard: WebKitKeyboard;
  #capturing = false;
  /** A text field in the page has focus: the Mac keyboard is its, not Couch's. */
  #fieldFocused = false;
  /** Counts what last said whether a field has focus: a page answer older than a later word is dropped. */
  #fieldSeq = 0;
  /** Something of Couch's own that takes the pointer and the keys is drawn over the page (Quick settings, a confirmation, Picture off). */
  #overlay = false;
  #disposed = false;
  /** The native view holds main-frame navigations for `navigating` while a Continue open is pending. */
  #guardOn = false;
  #stopResize: (() => void) | void = undefined;

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
    const gateOf = () => this.#keyGate;
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
      {
        pollsRoute: false,
        guard: (on) => {
          this.#guardOn = on;
          this.#view?.setNavigationGuard(on);
        },
      },
    );
    this.#keyboard = new WebKitKeyboard({
      emit: (event) => this.#emit(event),
      answer: (id, replay) => this.#view?.answerKey(id, replay),
      get gate() {
        return gateOf();
      },
      capturing: () => this.#capturing,
      fieldFocused: () => this.#fieldFocused,
      readClipboard: () => win.readClipboard?.() ?? "",
    });
    this.#stopResize = win.onResize(() => this.#fit());
  }

  /** Creates the view, registers its scripts, then loads the App's home. */
  start(): void {
    if (this.#view || this.#disposed) return;
    const view = this.#bridge.create({ store: this.#store, userAgent: this.#bridge.userAgent() });
    this.#view = view;
    this.#stopEvents = view.onEvent((event) => this.#onEvent(event));
    view.addMessageHandler(MESSAGE_HANDLER);
    if (this.#guardOn) view.setNavigationGuard(true);
    const desc = this.#desc;
    view.addUserScript(
      userScriptSource([
        PAGE_HOOKS_FUNCTION,
        KEY_CLAIM_FUNCTION,
        ...desc.preloads.map((p) => p.func),
      ]),
      "page",
    );
    view.addUserScript(
      userScriptSource([
        COUCH_HOST_WEBKIT,
        CONSOLE_FORWARD,
        MOUSE_INPUT_REPORTER,
        ...(desc.hideScrollbars ? [HIDE_SCROLLBARS_SCRIPT] : []),
        ...(desc.focus ? [pageFocusFunction(desc.focus.selectors, desc.focus.layout)] : []),
        routeReporter(desc.route.script),
      ]),
      "couch",
    );
    this.#syncDocumentStart();
    view.setVisible(false);
    this.#load();
  }

  /**
   * Couch's volume and the hidden-play guard, baked into a script every new document starts with, so autoplay
   * before the load finishes is already silenced and paused (hidden), and the volume holds from the first frame.
   * Each change of state replaces it, ahead of any later navigation; `evaluate` brings the current document along.
   */
  #syncDocumentStart(): void {
    const source = userScriptSource([
      `function () { ${soundScript(this.#soundLevel(), "", false)} }`,
      `function () { ${hiddenScript(!this.#visible)} }`,
    ]);
    this.#view?.setUserScript("sound", source, "couch");
  }

  /** A hidden App is silent: its media is at volume 0 whatever Couch's volume is. */
  #soundLevel(): number {
    return this.#visible ? this.#volume : 0;
  }

  #load(): void {
    this.#failed = false;
    this.#loaded = false;
    this.#view?.load(this.#core.firstUrl());
  }

  #onEvent(event: WebKitEvent): void {
    switch (event.type) {
      case "loaded":
        // The address change may have been answered by the old document; the new one is asked once it is there.
        this.#recheckField();
        if (this.#failed || !this.#isOwnPage(event.url)) return;
        // Where the page is comes first, so a "loaded" screen never shows over a stale route.
        this.#url = event.url;
        this.#core.openSettled();
        this.#core.syncRoute(event.url);
        this.#emit({ type: "loaded" });
        this.#loaded = true;
        if (!this.#visible) this.#run(hiddenScript(true));
        this.#applySound();
        this.#drawPendingNote();
        return;
      case "navigating":
        this.#view?.answerNavigation(event.id, this.#core.allowNavigation(event.url));
        return;
      case "failed":
        this.#failed = true;
        this.#recheckField();
        this.#emit({ type: "failed" });
        return;
      case "key":
        this.#onKey(event.key);
        return;
      case "navigated":
        this.#recheckField();
        this.#url = event.url;
        this.#core.navigated(event.url);
        return;
      case "message":
        if (event.name === MESSAGE_HANDLER) this.#onPageMessage(event.body, event.frame);
        return;
    }
  }

  /** A finished load counts only over https at one of the App's own hosts (the dev test page's loopback origin is its own too). */
  #isOwnPage(url: string): boolean {
    try {
      const u = new URL(url);
      return (
        (u.protocol === "https:" || u.hostname === "127.0.0.1") && this.#desc.isOwnOrigin(u.origin)
      );
    } catch {
      return false;
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
    } else if (message?.type === "input") {
      if (this.#visible && !this.#capturing) this.#emit({ type: "input" });
    } else if (message?.type === "wake-pointer" && this.#visible) {
      this.#view?.wakePointer(message.x, message.y);
    }
  }

  /**
   * The address changed: a new document has no field focused, but a pushState (Netflix's search after each letter)
   * leaves the field focused with no new focus event, so the page is asked instead of the flag being dropped.
   */
  #recheckField(): void {
    const view = this.#view;
    if (!view) return;
    const seq = ++this.#fieldSeq;
    const settle = (on: boolean) => {
      if (seq === this.#fieldSeq && this.#view === view) this.#setFieldFocused(on);
    };
    view.evaluate(FIELD_FOCUSED_QUERY, { kind: "expression" }).then(
      (on) => settle(on === true),
      () => settle(false),
    );
  }

  #setFieldFocused(on: boolean): void {
    this.#fieldSeq++;
    if (on === this.#fieldFocused) return;
    this.#fieldFocused = on;
    this.#route();
  }

  #onConsole(text: string): void {
    if (text === FIELD_FOCUSED) this.#setFieldFocused(true);
    else if (text === FIELD_BLURRED) this.#setFieldFocused(false);
    const pick = CONFIRM_MESSAGE.exec(text);
    if (!pick) return;
    const index = Number(pick[2]);
    // Answers count only while a confirmation is open, and only for one of its buttons.
    if (!Number.isInteger(index) || String(index) !== pick[2] || index >= this.#confirmButtons)
      return;
    this.#emit({ type: "confirm", index, answer: pick[1] === undefined });
  }

  /** A physical key the view was the first responder for; only while the App is on screen. */
  #onKey(key: WebKitKey): void {
    if (this.#visible) this.#keyboard.handle(key);
  }

  /** What the native side takes off Chromium's layer for the view: nothing while hidden, no pointer under an overlay. */
  #route(): void {
    const on = this.#visible;
    this.#view?.setInputRouting({
      keys: on,
      captureCommands: on && (this.#capturing || this.#overlay),
      fieldFocused: on && this.#fieldFocused,
      pointer: on && !this.#overlay,
    });
  }

  /**
   * Couch's own screen has something interactive over the page (Quick settings, a confirmation, Picture off):
   * it takes the pointer and every key, and the page gets the first responder back when it closes.
   */
  setOverlay(on: boolean): void {
    if (on === this.#overlay) return;
    this.#overlay = on;
    this.#route();
    if (!on && this.#visible) this.#view?.focus();
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

  show(note?: string): void {
    if (this.#disposed) return;
    this.#visible = true;
    const generation = ++this.#showGeneration;
    if (!this.#view) this.start();
    const view = this.#view!;
    this.#lifecycle?.shown();
    this.#syncDocumentStart();
    this.#core.shown();
    this.#fit();
    view.setVisible(true);
    this.#route();
    this.#run(hiddenScript(false));
    this.#applySound();
    if (note) {
      this.#pendingNote = note;
      if (this.#loaded) this.#drawPendingNote();
    }
    void this.#win.reveal().then(() => {
      if (this.#showGeneration === generation && this.#view === view) view.focus();
    });
  }

  /** The note is drawn in the page, over whatever Netflix shows, like the search bar; it removes itself. */
  #drawPendingNote(): void {
    const note = this.#pendingNote;
    this.#pendingNote = undefined;
    if (note && this.#visible) this.#run(noteScript(note));
  }

  hide(): void {
    this.#visible = false;
    this.#showGeneration++;
    this.#pendingNote = undefined;
    this.#confirmButtons = 0;
    this.#fieldFocused = false;
    this.#fieldSeq++;
    this.#core.hidden();
    this.#view?.setInputRouting({
      keys: false,
      captureCommands: false,
      fieldFocused: false,
      pointer: false,
    });
    this.#view?.setVisible(false);
    this.#win.focusScreen?.();
    this.#syncDocumentStart();
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
    this.#loaded = false;
    this.#confirmButtons = 0;
    this.#fieldFocused = false;
    this.#fieldSeq++;
    this.#core.reset();
  }

  /** The host is taken away for good (an engine switch): its view, window listener and timers go; the data store stays on disk. */
  dispose(): void {
    if (this.#disposed) return;
    if (this.#visible) this.hide();
    this.#disposed = true;
    this.#stopResize?.();
    this.#stopResize = undefined;
    this.#stopEvents?.();
    this.#view?.destroy();
    this.#view = undefined;
    this.#core.reset();
    this.#core.dispose();
    this.#listeners.clear();
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

  /** Asked first about every physical key (Quick settings and Picture off take keys here); true means it was handled. */
  setKeyGate(gate: KeyGate): void {
    this.#keyGate = gate;
  }

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
    // A WKWebView takes no media key, so play/pause for a page with no adapter is run in the page instead.
    if (keyCode === "MediaPlayPause") return this.#run(MEDIA_TOGGLE_SCRIPT);
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

  captureText(on: boolean): void {
    this.#capturing = on;
    this.#route();
  }

  openAt(url: string): void {
    this.#core.openAt(url, !!this.#view);
  }

  submitSearch(text: string): void {
    this.#core.submitSearch(text);
  }

  showSearchBar(text: string | undefined): void {
    this.#core.showSearchBar(text);
  }

  /** Couch's own screen draws the volume level: its page is transparent over a native view, so nothing is injected. */
  showVolume(_percent: number | undefined): void {}

  /**
   * Couch's screen draws the question (its buttons answer clicks and keys through the core, like on Home), so nothing
   * is injected; the host only remembers that one is open, to judge the answers a page might send.
   */
  showConfirm(confirm: Confirmation | undefined): void {
    this.#confirmButtons = confirm ? confirm.buttons.length : 0;
  }

  setVolume(percent: number): void {
    this.#volume = percent;
    this.#syncDocumentStart();
    this.#applySound();
  }

  #applySound(): void {
    this.#run(soundScript(this.#soundLevel(), "", false));
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
