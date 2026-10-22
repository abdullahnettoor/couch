import type { AppKey } from "../apps/app.ts";
import type { Addon } from "./addon.ts";

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
  /** The App plays Widevine content: the host waits for the components before loading it. */
  drm?: boolean;
  /** App-specific main-world functions (source text) that run after `couchHooks` and before any add-on. */
  preloads: PagePreload[];
  /** Turns on Couch's focus for the page: D-pad moves a ring between controls, OK clicks. */
  focus?: { selectors?: string[] };
  /** The add-ons this host can run, and the ids of those that are on now. */
  addons: Addon[];
  enabledAddons: string[];
}

/** What one skip sends to the page: keys, and whether OK commits them afterwards. */
export function seekPlan(
  desc: Pick<WebAppDescription, "skip" | "seekKeys">,
  seconds: number,
  controlsUp: boolean,
): { keys: AppKey[]; commit: boolean } {
  if (desc.skip) return { keys: desc.skip.keys(seconds, controlsUp), commit: true };
  if (desc.seekKeys)
    return { keys: [seconds < 0 ? desc.seekKeys.back : desc.seekKeys.forward], commit: false };
  return { keys: [], commit: false };
}

/** A route for a website App: home is decided from the address alone, no page script. */
export function urlRoute(isHome: (url: URL) => boolean): RouteSignals {
  return {
    script: "null",
    idle: null,
    tracker: () => ({
      update: (url) => {
        try {
          return { home: isHome(new URL(url)) };
        } catch {
          return undefined;
        }
      },
    }),
  };
}

export type DrmGate = { ok: true } | { ok: false; note: string };

const NO_WIDEVINE = "Widevine isn't available on this Mac, so this App can't play video.";

/** Whether a `drm` App may load: the components (Widevine) must be ready. */
export async function drmGate(
  desc: Pick<WebAppDescription, "drm">,
  components: { whenReady(): Promise<unknown> } | undefined,
): Promise<DrmGate> {
  if (!desc.drm) return { ok: true };
  if (!components) return { ok: false, note: NO_WIDEVINE };
  try {
    await components.whenReady();
    return { ok: true };
  } catch (error) {
    return { ok: false, note: `${NO_WIDEVINE} (${String(error)})` };
  }
}
