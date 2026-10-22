import { chromeIdentity } from "../../web/chrome-identity.ts";
import { urlRoute, type WebAppDescription } from "../../web/web-app.ts";
import {
  isNetflixHome,
  isNetflixOrigin,
  isNetflixSearchUrl,
  netflixSearchUrlFor,
} from "./netflix-route.ts";

export const NETFLIX_URL = "https://www.netflix.com/browse";
export const NETFLIX_PARTITION = "persist:netflix";

/** Netflix's title cards and profile tiles, on top of the host's default controls. */
const FOCUS_SELECTORS = [".title-card", ".profile-link"];

/** Netflix as a web App: its normal website as Chrome, Widevine, Couch's focus, seek by arrow keys. */
export function netflixDescription(version?: string): WebAppDescription {
  return {
    id: "netflix",
    url: NETFLIX_URL,
    partition: NETFLIX_PARTITION,
    identity: chromeIdentity(version),
    keyCodes: {
      up: "Up",
      down: "Down",
      left: "Left",
      right: "Right",
      ok: "Return",
      back: "Escape",
    },
    // Back is the browser's: it closes the player and the title modal (both are history entries).
    backByHistory: true,
    isOwnOrigin: isNetflixOrigin,
    search: {
      isSearchUrl: isNetflixSearchUrl,
      urlFor: netflixSearchUrlFor,
      placeholder: "Search Netflix",
    },
    route: urlRoute(isNetflixHome),
    seekKeys: { back: "left", forward: "right" },
    drm: true,
    // Signed in, browse autoplays a billboard trailer: it must not play before Netflix is opened.
    loadOnShow: true,
    focus: { selectors: FOCUS_SELECTORS },
    preloads: [],
    addons: [],
    enabledAddons: [],
  };
}
