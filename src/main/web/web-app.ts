import type { AppKey } from "../apps/app.ts";
import type { PromptId, TrackKind } from "../../shared/protocol.ts";
import type { Addon } from "./addon.ts";
import type { FocusLayout } from "./page-focus.ts";

/** The identity a web App presents: one user agent and client hints, on the page, its frames and every request. */
export interface WebIdentity {
  userAgent: string;
  /** Client-hint metadata for navigator.userAgentData. */
  metadata: Record<string, unknown>;
  /** The request headers to send for this URL, given the ones so far. */
  headersFor(url: URL, headers: Record<string, string>): Record<string, string>;
}

export interface WebRoute {
  home: boolean;
  shorts?: boolean;
  guideOpen?: boolean;
  /** The address says home but the page is scrolled down (Back scrolls up). */
  scrolled?: boolean;
  /** The address, so a move between two pages that are both "not home" still counts as a change. */
  url?: string;
}

export interface RouteSignals {
  /** Runs in the page; its result is handed to `tracker.update` with the URL. */
  script: string;
  /** What the page reports before it has answered. */
  idle: unknown;
  /** One tracker per host; it reports each change of route or page state. */
  tracker(): { update(url: string, page: any): WebRoute | undefined };
}

/** A main-world function (source text, `function () { ... }`) that runs before the page's scripts, with a name for the log. */
export interface PagePreload {
  name: string;
  func: string;
}

/**
 * What a web App adds to the shared playback layer where the plain video isn't enough. Each member
 * returns page script source (like `route.script`); absent members fall back to the App's keys.
 */
export interface PlaybackAdapter {
  /** An expression that is false while the App is not in its playback view (autoplaying home previews); nothing is reported then. */
  active?(): string;
  /** Jumps to this position, in seconds. */
  seek?(seconds: number): string;
  /** An expression giving `{ subtitles, audio }` (lists of `{ id, label, on }`), or a promise of it; falsy when the App's controls aren't there. */
  tracks?(): string;
  /** Toggles play and pause through the App's own control; absent, the host sends the media key. */
  playPause?(): string;
  /** An expression that is true while the App plays an ad (not the title): nothing is remembered from it. */
  ad?(): string;
  /** An expression giving the App's own id for what plays (or falsy), so a Now Playing hint can be matched to it. */
  titleId?(): string;
  /** An expression giving the title of what plays (or falsy), when the page's media session names none. */
  title?(): string;
  /** An expression giving an artwork URL (or falsy) for what plays, when the page's media session names none. */
  artwork?(): string;
  /** An expression giving `{ id, label }` for the App's own prompt button when one is visible (Skip Intro, Next Episode), else falsy. */
  prompt?(): string;
  /** Presses the prompt button with this id. */
  pressPrompt?(id: PromptId): string;
  /** The speeds the page's video can play at, when its `playbackRate` can be set directly (reported from the video). Without it an adapter's `tracks` may report `speed` and `speeds` itself. */
  speeds?: number[];
  /** Sets the playback speed (1 = normal). */
  setSpeed?(speed: number): string;
  /** Chooses the track with this id from the list `tracks` gave. */
  setTrack?(kind: TrackKind, id: string): string;
}

/** Everything that makes a web App itself: the host (`ElectronWebApp`) holds none of it. */
export interface WebAppDescription {
  id: string;
  url: string;
  partition: string;
  identity: WebIdentity;
  keyCodes: Record<AppKey, string>;
  isOwnOrigin(origin: string): boolean;
  /** Present when the App takes typed search; without it the App has no typing. */
  search?: {
    isSearchUrl(url: string): boolean;
    urlFor(text: string): string;
    /** The floating search bar's empty text, e.g. "Search YouTube". */
    placeholder: string;
  };
  route: RouteSignals;
  /** App-specific key sequences for a skip, and when to commit it with OK. */
  skip?: {
    keys(seconds: number, controlsUp: boolean): AppKey[];
    controlsHideMs: number;
    commitMs: number;
  };
  /** Without `skip`: the App's own seek keys, sent once per skip. */
  seekKeys?: { back: AppKey; forward: AppKey };
  /** Back sent to the page goes back in its history instead of pressing `keyCodes.back`, except with a pop-up open (the page script says), which it closes with `keyCodes.back`. */
  backByHistory?: boolean;
  /** The App plays Widevine content: the host waits for the components before loading it. */
  drm?: boolean;
  /** App-specific main-world functions (source text) that run after `couchHooks` and before any add-on. */
  preloads: PagePreload[];
  /** The site draws desktop scrollbars; hide them (scrolling still works). */
  hideScrollbars?: boolean;
  /** Domains (with their subdomains) the App's own artwork comes from; Now Playing artwork from anywhere else is dropped, since every Remote fetches it. */
  artworkHosts?: string[];
  /**
   * Turns the page's address and the playing position (seconds) into the address that reopens this title there,
   * built only from the title's id and the time; undefined for anything else (browse, search, another origin).
   */
  resume?(url: string, position: number): string | undefined;
  /** Present when the plain video isn't enough: seeking and tracks through the App's own player. */
  playback?: PlaybackAdapter;
  /** Turns on Couch's focus for the page: D-pad moves a ring between controls, OK clicks. */
  focus?: { selectors?: string[]; layout?: FocusLayout };
  /** The add-ons this host can run, and the ids of those that are on now. */
  addons: Addon[];
  enabledAddons: string[];
}
