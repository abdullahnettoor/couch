import { chromeIdentity } from "../../web/chrome-identity.ts";
import type { FocusLayout } from "../../web/page-focus.ts";
import type { WebAppDescription } from "../../web/web-app.ts";
import {
  isNetflixOrigin,
  isNetflixSearchUrl,
  netflixRoute,
  netflixSearchUrlFor,
} from "./netflix-route.ts";

export const NETFLIX_URL = "https://www.netflix.com/browse";
export const NETFLIX_PARTITION = "persist:netflix";

/** Netflix's title cards (any row style), the details' buttons and the profile tiles, on top of the host's default controls. */
const FOCUS_SELECTORS = [
  ".title-card",
  ".profile-link",
  '[data-uia$="-card"]',
  '[data-uia="play-button"]',
  '[data-uia="add-to-my-list"]',
  '[data-uia="thumbs-rate-button"]',
  '[role="menuitem"]',
];

/** How Netflix is laid out: rows of cards, a details modal, a player that wants no highlight. */
export const NETFLIX_LAYOUT: FocusLayout = {
  // The player: Netflix's own keys (Space/OK, Left/Right, Up/Down) must reach it.
  noRing: [{ url: "^https://www\\.netflix\\.com/watch/" }],
  // Duplicates and helpers the carousel pages by itself.
  ignore: ['[tabindex="-1"]', '[data-uia^="carousel-hawkins"]'],
  scopes: ['[data-uia^="modal-motion-container"]'],
  rows: {
    row: '[data-uia^="carousel-row-section"]',
    next: '[data-uia="carousel-hawkins-right-button"]',
    prev: '[data-uia="carousel-hawkins-left-button"]',
  },
};

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
    route: netflixRoute(),
    seekKeys: { back: "left", forward: "right" },
    drm: true,
    // Signed in, browse autoplays a billboard trailer: it must not play before Netflix is opened.
    loadOnShow: true,
    focus: { selectors: FOCUS_SELECTORS, layout: NETFLIX_LAYOUT },
    preloads: [],
    addons: [],
    enabledAddons: [],
  };
}
