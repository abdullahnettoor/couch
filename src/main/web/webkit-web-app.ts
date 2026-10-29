import type { Confirmation, PromptId, TrackKind } from "../../shared/protocol.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import { hiddenScript } from "./hidden-audio.ts";
import { BACK_QUERY, backAction, pageFocusFunction, typeIntoFieldScript } from "./page-focus.ts";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import {
  composeReport,
  playbackProbe,
  sameReport,
  skipTarget,
  type PlaybackReport,
  type TrackReport,
} from "./playback.ts";
import { seekPlan } from "./seek-plan.ts";
import type { IdleLifecycle } from "./idle-unload.ts";
import type { WebAppDescription } from "./web-app.ts";
import {
  webkitStoreId,
  type WebKitBridge,
  type WebKitEvent,
  type WebKitView,
} from "./webkit-bridge.ts";
import { CONFIRM_MESSAGE, searchBarScript } from "./web-hud.ts";
import { soundScript } from "./web-sound.ts";

const TRACKS_EVERY_MS = 2000;
const POLL_MS = 400;
/** The one script message handler the page talks to Couch through. */
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
 * WebKit has no console-message event: the page's `console.debug("couch:...")` signals (field focus,
 * the confirmation's buttons, the sound re-check) are forwarded to the message handler instead.
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
 * description. The page's preloads and route reporting are user scripts that talk back through one
 * script message handler; keys are native NSEvents; everything else is `evaluate`.
 */
export class WebKitWebApp implements YouTube {
  #desc: WebAppDescription;
  #bridge: WebKitBridge;
  #win: WebKitHostWindow;
  #lifecycle: IdleLifecycle | undefined;
  #view: WebKitView | undefined;
  #stopEvents: (() => void) | undefined;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #visible = false;
  #failed = false;
  #page: unknown;
  #url = "";
  #routes: ReturnType<WebAppDescription["route"]["tracker"]>;
  #report: PlaybackReport | undefined;
  #probing = false;
  #tracks: TrackReport | undefined;
  #tracksAt = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #volume = 60;
  #lastSkipAt = 0;
  #skipTimer: ReturnType<typeof setTimeout> | undefined;
  #inSearch = false;

  constructor(
    desc: WebAppDescription,
    bridge: WebKitBridge,
    win: WebKitHostWindow,
    lifecycle?: IdleLifecycle,
  ) {
    this.#desc = desc;
    this.#bridge = bridge;
    this.#win = win;
    this.#lifecycle = lifecycle;
    this.#page = desc.route.idle;
    this.#routes = desc.route.tracker();
    win.onResize(() => this.#fit());
  }

  /** Creates the view, registers its scripts, then loads the App's home. */
  start(): void {
    if (this.#view) return;
    const view = this.#bridge.create({
      storeId: webkitStoreId(this.#desc.id),
      userAgent: this.#bridge.userAgent(),
    });
    this.#view = view;
    this.#stopEvents = view.onEvent((event) => this.#onEvent(event));
    view.addMessageHandler(MESSAGE_HANDLER);
    view.addUserScript(userScriptSource(this.#preloads()));
    view.setVisible(false);
    this.#load();
  }

  #preloads(): string[] {
    const desc = this.#desc;
    return [
      PAGE_HOOKS_FUNCTION,
      CONSOLE_FORWARD,
      ...desc.preloads.map((p) => p.func),
      ...(desc.focus ? [pageFocusFunction(desc.focus.selectors, desc.focus.layout)] : []),
      routeReporter(desc.route.script),
    ];
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
        this.#applySound();
        return;
      case "failed":
        this.#failed = true;
        this.#emit({ type: "failed" });
        return;
      case "navigated":
        this.#url = event.url;
        this.#syncRoute();
        return;
      case "message":
        if (event.name === MESSAGE_HANDLER) this.#onPageMessage(event.body);
        return;
    }
  }

  #onPageMessage(body: unknown): void {
    const message = body as { type?: string; url?: string; page?: unknown; message?: string };
    if (message?.type === "route" && typeof message.url === "string") {
      this.#url = message.url;
      this.#page = message.page ?? this.#desc.route.idle;
      this.#syncRoute();
    } else if (message?.type === "console" && typeof message.message === "string") {
      this.#onConsole(message.message);
    }
  }

  #onConsole(text: string): void {
    const pick = CONFIRM_MESSAGE.exec(text);
    if (pick)
      this.#emit({ type: "confirm", index: Number(pick[2]), answer: pick[1] === undefined });
  }

  #syncRoute(): void {
    if (!this.#url.startsWith("https:")) return;
    const route = this.#routes.update(this.#url, this.#page);
    if (route) this.#emit({ type: "route", ...route });
    const searching = this.#desc.search?.isSearchUrl(this.#url) ?? false;
    const entering = searching && !this.#inSearch;
    this.#inSearch = searching;
    if (entering) setTimeout(() => this.#emit({ type: "searchOpened" }), 400);
  }

  #emit(event: YouTubeEvent): void {
    for (const l of Array.from(this.#listeners)) l(event);
  }

  #run(script: string): void {
    void this.#view?.evaluate(script).catch(() => {});
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
    this.#timer ??= setInterval(() => this.#pollPlayback(), POLL_MS);
    this.#fit();
    view.setVisible(true);
    this.#run(hiddenScript(false));
    void this.#win.reveal().then(() => view.focus());
  }

  hide(): void {
    this.#visible = false;
    this.#tracks = undefined;
    this.#tracksAt = 0;
    this.#reportPlayback(undefined);
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#view?.setVisible(false);
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
    this.#inSearch = false;
    this.#url = "";
    this.#page = this.#desc.route.idle;
    this.#routes = this.#desc.route.tracker();
    this.#emit({ type: "route", home: true });
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

  #pollPlayback(): void {
    const view = this.#view;
    if (!view || this.#probing || !this.#visible) return;
    const adapter = this.#desc.playback;
    const now = Date.now();
    const askTracks = !!adapter?.tracks && now - this.#tracksAt >= TRACKS_EVERY_MS;
    this.#probing = true;
    view
      .evaluate(
        playbackProbe({
          tracks: askTracks ? adapter!.tracks!() : undefined,
          active: adapter?.active?.(),
          speeds: adapter?.speeds,
          artwork: adapter?.artwork?.(),
          prompt: adapter?.prompt?.(),
        }),
      )
      .then((found) => {
        if (!this.#visible) return;
        const report = (found ?? undefined) as PlaybackReport | undefined;
        if (askTracks) {
          this.#tracksAt = now;
          this.#tracks = report?.tracks as TrackReport | undefined;
        }
        this.#reportPlayback(
          composeReport(report, this.#tracks, !!adapter?.seek, this.#desc.artworkHosts),
        );
      })
      .catch(() => {})
      .finally(() => {
        this.#probing = false;
      });
  }

  #reportPlayback(next: PlaybackReport | undefined): void {
    if (sameReport(this.#report, next)) return;
    this.#report = next;
    this.#emit({ type: "playback", playback: next });
  }

  seekTo(seconds: number): void {
    const script = this.#desc.playback?.seek?.(seconds);
    if (script) this.#run(script);
  }

  pressPrompt(id: PromptId): void {
    const script = this.#desc.playback?.pressPrompt?.(id);
    if (script) this.#run(script);
  }

  setSpeed(speed: number): void {
    const script = this.#desc.playback?.setSpeed?.(speed);
    if (script) this.#run(script);
  }

  setTrack(kind: TrackKind, id: string): void {
    const script = this.#desc.playback?.setTrack?.(kind, id);
    if (script) this.#run(script);
  }

  sendKey(key: YouTubeKey): void {
    const keyCode = this.#desc.keyCodes[key];
    const view = this.#view;
    if (!view) return;
    if (key === "back" && this.#desc.backByHistory) {
      void view
        .evaluate(BACK_QUERY)
        .catch(() => "")
        .then((answer) => {
          const todo = backAction(answer);
          if (todo === "history") return this.#run("history.back()");
          if (todo === "press") this.#press(keyCode);
          this.#emit({ type: "backHandled" });
        });
      return;
    }
    this.#press(keyCode);
  }

  #press(keyCode: string): void {
    const view = this.#view;
    if (!view) return;
    view.sendKey(keyCode, true);
    view.sendKey(keyCode, false);
  }

  scrollToTop(): void {
    this.#run("window.scrollTo({ top: 0, behavior: 'smooth' })");
  }

  playPause(): void {
    const script = this.#desc.playback?.playPause?.();
    if (script) this.#run(script);
  }

  seekBy(seconds: number): void {
    const target = this.#desc.playback?.seek ? skipTarget(this.#report, seconds) : undefined;
    if (target !== undefined) return this.seekTo(target);
    if (this.#desc.focus) {
      this.#run(
        `window.__couchRawKeys && window.__couchRawKeys(${(this.#desc.skip?.commitMs ?? 0) + 1500})`,
      );
    }
    const now = Date.now();
    const skip = this.#desc.skip;
    const plan = seekPlan(
      this.#desc,
      seconds,
      now - this.#lastSkipAt < (skip?.controlsHideMs ?? 0),
    );
    for (const key of plan.keys) this.sendKey(key);
    if (!skip || !plan.commit) return;
    this.#lastSkipAt = now;
    clearTimeout(this.#skipTimer);
    this.#skipTimer = setTimeout(() => {
      this.sendKey("ok");
      this.#lastSkipAt = 0;
    }, skip.commitMs);
  }

  /** The Mac keyboard doesn't reach a WebKit view through Electron's events yet (ticket 112). */
  captureText(_on: boolean): void {}

  submitSearch(text: string): void {
    const view = this.#view;
    if (!view || !this.#desc.search) return;
    void view
      .evaluate(typeIntoFieldScript(text))
      .catch(() => false)
      .then((typed) => {
        if (typed === true) return view.focus();
        this.#inSearch = true;
        const url = this.#desc.search!.urlFor(text);
        if (this.#url !== url) view.load(url);
        view.focus();
      });
  }

  showSearchBar(text: string | undefined): void {
    const search = this.#desc.search;
    if (search) this.#run(searchBarScript(text, search.placeholder));
  }

  /** Couch's own screen draws the volume level and confirmations over a native view (ticket 111 checks them). */
  showVolume(_percent: number | undefined): void {}

  showConfirm(_confirm: Confirmation | undefined): void {}

  setVolume(percent: number): void {
    this.#volume = percent;
    this.#applySound();
  }

  #applySound(): void {
    this.#run(soundScript(this.#volume, "", false));
  }

  /** The sound output follows the Mac for now (ticket 114 settles `setSinkId`). */
  async setOutputDevice(name: string | undefined): Promise<boolean> {
    if (name === undefined) return true;
    this.#emit({ type: "output", name, ok: false });
    return false;
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
