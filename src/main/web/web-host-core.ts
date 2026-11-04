import type { PromptId, TrackKind } from "../../shared/protocol.ts";
import type { YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import { BACK_QUERY, backAction, typeIntoFieldScript } from "./page-focus.ts";
import {
  composeReport,
  playbackProbe,
  sameReport,
  skipTarget,
  type PlaybackReport,
  type TrackReport,
} from "./playback.ts";
import { titleKey } from "./resume-url.ts";
import { seekPlan } from "./seek-plan.ts";
import type { WebAppDescription } from "./web-app.ts";
import { searchBarScript } from "./web-hud.ts";

const TRACKS_EVERY_MS = 2000;
export const POLL_MS = 400;

/** What a web-App host's engine (Chromium's `WebContents`, a native `WKWebView`) gives the shared logic. */
export interface HostEngine {
  /** Runs a script in the App's page; rejects when it throws. */
  run(script: string): Promise<unknown>;
  /** A native key press (down, then up) of this key code of the description. */
  press(keyCode: string): void;
  /** History back in the page; the engine knows when that is safe. */
  goBack(): void;
  /** Whether history back has a page of the App's to go to (not the engine's blank start). */
  canGoBack(): boolean | Promise<boolean>;
  /** The address the page is at. */
  url(): string;
  load(url: string): void;
  /** Gives the page keyboard focus. */
  focus(): void;
  visible(): boolean;
}

/**
 * What every web-App host does the same way whatever engine draws the page: route handling, playback
 * polling, the adapter's commands, seeking, Back and search. Input capture and the view's lifecycle stay
 * in the engine-specific host, which composes one of these.
 */
export class WebHostCore {
  #desc: WebAppDescription;
  #engine: HostEngine;
  #emit: (event: YouTubeEvent) => void;
  #pollsRoute: boolean;
  #page: unknown;
  #routes: ReturnType<WebAppDescription["route"]["tracker"]>;
  #report: PlaybackReport | undefined;
  #probing = false;
  #tracks: TrackReport | undefined;
  #tracksAt = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #inSearch = false;
  #skipTimer: ReturnType<typeof setTimeout> | undefined;
  #searchTimer: ReturnType<typeof setTimeout> | undefined;
  #lastSkipAt = 0;
  /** An address asked for before the page's first load: that load goes there instead of home. */
  #startUrl: string | undefined;
  /** A Continue open is on its way: until the page has loaded, navigation off the App's own sites is cancelled. */
  #pendingOpen = false;
  #homeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The page is at the App's home, as its route last said. */
  #atHome = true;
  #guard: (on: boolean) => void;

  /** `pollsRoute`: ask the page for its state every tick (otherwise the engine pushes it with `setPage`). */
  constructor(
    desc: WebAppDescription,
    engine: HostEngine,
    emit: (event: YouTubeEvent) => void,
    options: { pollsRoute: boolean; guard?: (on: boolean) => void },
  ) {
    this.#guard = options.guard ?? (() => {});
    this.#desc = desc;
    this.#engine = engine;
    this.#emit = emit;
    this.#pollsRoute = options.pollsRoute;
    this.#page = desc.route.idle;
    this.#routes = desc.route.tracker();
  }

  /** The App's own page state (from its route script), as the engine learns it. */
  setPage(page: unknown): void {
    this.#page = page ?? this.#desc.route.idle;
  }

  /** Tells the core whether the App is on its home screen (a Short keeps Home's URL, so the page state is part of it). */
  syncRoute(url: string): void {
    const route = this.#routes.update(url, this.#page);
    if (!route) return;
    this.#atHome = route.home;
    this.#emit({ type: "route", ...route });
  }

  /** The page went to `url` (a navigation or a route report): the route, and arriving at search. */
  navigated(url: string): void {
    if (!url.startsWith("https:")) return;
    this.syncRoute(url);
    const searching = this.#desc.search?.isSearchUrl(url) ?? false;
    const entering = searching && !this.#inSearch;
    this.#inSearch = searching;
    // Only arriving at search counts; Couch's own query updates also change the route.
    if (entering) {
      clearTimeout(this.#searchTimer);
      this.#searchTimer = setTimeout(() => this.#emit({ type: "searchOpened" }), 400);
    }
  }

  /**
   * Opens the App at `url`, which must be one of the addresses the description's `resume` hook builds (its title's
   * canonical address, with or without the time); anything else is refused. With the page not loaded yet, its first
   * load goes there (see `firstUrl`); otherwise the page navigates now. Until the page has loaded, `allowNavigation`
   * cancels any move off the App's own sites.
   */
  openAt(url: string, loadIssued: boolean): void {
    if (!this.#isResumeAddress(url)) return;
    this.#setPending(true);
    if (loadIssued) this.#engine.load(url);
    else this.#startUrl = url;
  }

  #isResumeAddress(url: string): boolean {
    if (!this.#isOwnPage(url)) return false;
    const built = this.#desc.resume?.(url, 0);
    return built !== undefined && titleKey(built) === titleKey(url);
  }

  #setPending(on: boolean): void {
    if (this.#pendingOpen === on) return;
    this.#pendingOpen = on;
    this.#guard(on);
  }

  /** The page finished loading: a Continue open that was on its way has arrived. */
  openSettled(): void {
    this.#setPending(false);
  }

  /**
   * The engine asks before the page's top frame goes to `url` (a link, a script or a redirect). While a Continue open is
   * pending only the App's own https sites pass (never data:, javascript: or another host); anything else is cancelled,
   * and the App is back at its home with a `blocked` event for core to say so. Otherwise everything passes.
   */
  allowNavigation(url: string): boolean {
    if (!this.#pendingOpen || this.#isOwnPage(url)) return true;
    this.#setPending(false);
    this.#startUrl = undefined;
    // After the engine has cancelled this navigation: loading in its middle could be cancelled with it.
    clearTimeout(this.#homeTimer);
    this.#homeTimer = setTimeout(() => this.#engine.load(this.#desc.url), 0);
    this.#emit({ type: "blocked" });
    return false;
  }

  #isOwnPage(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && this.#desc.isOwnOrigin(u.origin);
    } catch {
      return false;
    }
  }

  /** What the page's first load asks for: the address `openAt` was given, once, else the App's home. */
  firstUrl(): string {
    const url = this.#startUrl ?? this.#desc.url;
    this.#startUrl = undefined;
    return url;
  }

  /** The page is gone (an idle unload): back to a fresh, home-bound state. */
  reset(): void {
    this.#inSearch = false;
    this.#page = this.#desc.route.idle;
    this.#routes = this.#desc.route.tracker();
    this.#atHome = true;
    this.#startUrl = undefined;
    this.#setPending(false);
    this.#emit({ type: "route", home: true });
  }

  /** The host is going for good: no timer of the core's is left running. */
  dispose(): void {
    this.hidden();
    clearTimeout(this.#skipTimer);
    this.#skipTimer = undefined;
    clearTimeout(this.#searchTimer);
    this.#searchTimer = undefined;
    clearTimeout(this.#homeTimer);
    this.#homeTimer = undefined;
    this.#setPending(false);
  }

  shown(): void {
    this.#timer ??= setInterval(() => this.#poll(), POLL_MS);
  }

  hidden(): void {
    this.#tracks = undefined;
    this.#tracksAt = 0;
    this.#reportPlayback(undefined);
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #poll(): void {
    this.#pollPlayback();
    if (!this.#pollsRoute) return;
    void this.#engine
      .run(this.#desc.route.script)
      .then((page) => {
        this.#page = page;
        this.syncRoute(this.#engine.url());
      })
      .catch(() => {});
  }

  /** Reads the page's playing video; tracks come from the adapter, asked at most every 2 s. */
  #pollPlayback(): void {
    if (this.#probing || !this.#engine.visible()) return;
    const adapter = this.#desc.playback;
    const now = Date.now();
    const askTracks = !!adapter?.tracks && now - this.#tracksAt >= TRACKS_EVERY_MS;
    this.#probing = true;
    void this.#engine
      .run(
        playbackProbe({
          tracks: askTracks ? adapter!.tracks!() : undefined,
          active: adapter?.active?.(),
          ad: adapter?.ad?.(),
          speeds: adapter?.speeds,
          artwork: adapter?.artwork?.(),
          title: adapter?.title?.(),
          id: adapter?.titleId?.(),
          prompt: adapter?.prompt?.(),
        }),
      )
      .then((answer) => {
        if (!this.#engine.visible()) return;
        const found = (answer ?? undefined) as PlaybackReport | undefined;
        if (askTracks) {
          this.#tracksAt = now;
          this.#tracks = found?.tracks as TrackReport | undefined;
        }
        const report = composeReport(found, this.#tracks, !!adapter?.seek, this.#desc.artworkHosts);
        // An ad is not the title: no address to resume.
        const resume =
          report && !report.ad && this.#desc.resume?.(this.#engine.url(), report.position);
        this.#reportPlayback(report && resume ? { ...report, resume } : report);
      })
      .catch(() => this.#reportPlayback(undefined))
      .finally(() => {
        this.#probing = false;
      });
  }

  #reportPlayback(next: PlaybackReport | undefined): void {
    if (sameReport(this.#report, next)) return;
    this.#report = next;
    this.#emit({ type: "playback", playback: next });
  }

  #run(script: string): void {
    void this.#engine.run(script).catch(() => {});
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

  playPause(): void {
    const playback = this.#desc.playback;
    if (playback?.playPause) return this.#run(playback.playPause());
    this.#engine.press("MediaPlayPause");
  }

  sendKey(key: YouTubeKey): void {
    const keyCode = this.#desc.keyCodes[key];
    if (key === "back" && this.#desc.backByHistory) {
      // The player's bar and a pop-up close the site's own way (its Escape, or the page hiding the bar); history back is for the player and pages Couch doesn't know.
      void this.#engine
        .run(BACK_QUERY)
        .catch(() => "")
        .then((answer) => {
          const todo = backAction(answer);
          if (todo === "history") return this.#historyBack();
          if (todo === "press") this.#engine.press(keyCode);
          this.#emit({ type: "backHandled" });
        });
      return;
    }
    this.#engine.press(keyCode);
  }

  /**
   * History back, or the App's home when there is no page behind this one: a title that was the page's first load
   * (a Continue open, a deep link) has nothing to go back to, and Back must still reach home.
   */
  async #historyBack(): Promise<void> {
    const can = await Promise.resolve(this.#engine.canGoBack()).catch(() => false);
    if (can) this.#engine.goBack();
    else if (!this.#atHome) this.#engine.load(this.#desc.url);
  }

  scrollToTop(): void {
    this.#run("window.scrollTo({ top: 0, behavior: 'smooth' })");
  }

  /**
   * Skips by the adapter's seek, else by driving the App's own scrubber with keys (Left/Right, then
   * OK after the last press). j/l, media fast-forward keys and bare arrows do not seek in YouTube's TV player.
   */
  seekBy(seconds: number): void {
    const target = this.#desc.playback?.seek ? skipTarget(this.#report, seconds) : undefined;
    if (target !== undefined) return this.seekTo(target);
    // Keys for the player, not for Couch's focus layer (which would move its highlight over the bar).
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

  submitSearch(text: string): void {
    const search = this.#desc.search;
    if (!search) return;
    // A field in the page that has focus (a sign-in form) is what the household is typing into.
    void this.#engine
      .run(typeIntoFieldScript(text))
      .catch(() => false)
      .then((typed) => {
        if (typed === true) return this.#engine.focus();
        // Going to search is Couch's own doing, not the household opening the App's search screen.
        this.#inSearch = true;
        const url = search.urlFor(text);
        if (this.#engine.url() !== url) this.#engine.load(url);
        this.#engine.focus();
      });
  }

  showSearchBar(text: string | undefined): void {
    const search = this.#desc.search;
    if (search) this.#run(searchBarScript(text, search.placeholder));
  }
}
