import type { WebAppDescription } from "../../web/web-app.ts";
import { YOUTUBE_ADDONS } from "./addons/index.ts";
import { compatEnabled } from "./addons/4k.ts";
import { enabledAddons, type AddonChoices } from "../../web/addon.ts";
import { applyToRequestHeaders, buildIdentity } from "./youtube-identity.ts";
import { isYouTubeOrigin, PAGE_STATE_SCRIPT, RouteTracker } from "./youtube-route.ts";
import { CONTROLS_HIDE_MS, SKIP_COMMIT_MS, skipKeys } from "./youtube-skip.ts";

export const YOUTUBE_URL = "https://www.youtube.com/tv";
export const YOUTUBE_PARTITION = "persist:youtube";
export const SEARCH_URL = "https://www.youtube.com/tv#/search";

/** YouTube TV's own search deep link: it fills the search box and shows results for the text. */
export function searchUrlFor(text: string): string {
  const q = text.trim();
  return q ? `${SEARCH_URL}?q=${encodeURIComponent(q)}` : SEARCH_URL;
}

export function isSearchUrl(url: string): boolean {
  return /#\/search\b/.test(url);
}

/** YouTube as a web App; plain Chrome UAs get a "going to youtube.com" page, so it presents the Cobalt TV identity. */
export function youtubeDescription(
  version: string,
  env: Record<string, string | undefined> = process.env,
  choices: AddonChoices = {},
): WebAppDescription {
  const identity = buildIdentity(version);
  return {
    id: "youtube",
    url: YOUTUBE_URL,
    partition: YOUTUBE_PARTITION,
    identity: {
      userAgent: identity.userAgent,
      metadata: identity.metadata,
      headersFor: (url, headers) => applyToRequestHeaders(identity, url, headers),
    },
    keyCodes: {
      up: "Up",
      down: "Down",
      left: "Left",
      right: "Right",
      ok: "Return",
      back: "Escape",
    },
    isOwnOrigin: isYouTubeOrigin,
    search: { isSearchUrl, urlFor: searchUrlFor, placeholder: "Search YouTube" },
    route: {
      script: PAGE_STATE_SCRIPT,
      idle: { shorts: false, guide: false },
      tracker: () => new RouteTracker(),
    },
    skip: { keys: skipKeys, controlsHideMs: CONTROLS_HIDE_MS, commitMs: SKIP_COMMIT_MS },
    preloads: [],
    // COUCH_YOUTUBE_PATCH=off keeps the stock 720p behaviour whatever Settings says.
    addons: YOUTUBE_ADDONS.filter((a) => a.id !== "4k" || compatEnabled(env)),
    enabledAddons: enabledAddons(YOUTUBE_ADDONS, choices).map((a) => a.id),
  };
}
