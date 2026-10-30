import { chromeIdentity } from "../../web/chrome-identity.ts";
import type { FocusLayout } from "../../web/page-focus.ts";
import type { WebAppDescription } from "../../web/web-app.ts";
import { NETFLIX_ART_PRELOAD } from "./netflix-artwork.ts";
import { NETFLIX_PLAYBACK } from "./netflix-playback.ts";
import {
  isNetflixOrigin,
  isNetflixSearchUrl,
  netflixResumeUrl,
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
  // A title's pop-up opens on Play / Resume; with none, on the first of its action buttons (My List, rate), never on its text links.
  modalEntry: [
    '[data-uia="play-button"]',
    '[data-uia="add-to-my-list"],[data-uia="thumbs-rate-button"]',
  ],
  // Down brings up Netflix's own bar; the arrows walk it, and its audio and subtitles menu.
  playerBar: {
    url: "^https://www\\.netflix\\.com/watch/",
    controls: [
      'button[data-uia^="control-"]',
      'button[data-uia^="player-skip"]',
      '[data-uia^="next-episode"]',
    ],
    menus: ['[data-uia^="selector-"]'],
    items: ["[tabindex]:not([tabindex='-1'])", "button"],
    start: '[data-uia^="control-play-pause"]',
    idleMs: 5000,
  },
  // A card links to /browse?jbv=<id> (older ones /watch/<id> or /title/<id>): that id, with its row, finds the card again after Netflix redraws the row.
  titleId: "(?:/(?:watch|title)/|[?&]jbv=)(\\d+)",
  rows: {
    row: '[data-uia^="carousel-row-section"]',
    next: '[data-uia="carousel-hawkins-right-button"]',
    prev: '[data-uia="carousel-hawkins-left-button"]',
  },
};

/** Netflix as a web App: its normal website as Chrome, Widevine, Couch's focus, ±10 s by arrow keys, seek, subtitles and audio through its own controls. */
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
    // Back is the browser's for the player and pages Couch doesn't know; a title's pop-up closes with Netflix's own Escape.
    backByHistory: true,
    isOwnOrigin: isNetflixOrigin,
    resume: (url) => netflixResumeUrl(url),
    search: {
      isSearchUrl: isNetflixSearchUrl,
      urlFor: netflixSearchUrlFor,
      placeholder: "Search Netflix",
    },
    route: netflixRoute(),
    seekKeys: { back: "left", forward: "right" },
    drm: true,
    focus: { selectors: FOCUS_SELECTORS, layout: NETFLIX_LAYOUT },
    preloads: [NETFLIX_ART_PRELOAD],
    hideScrollbars: true,
    artworkHosts: ["nflximg.net", "nflxso.net", "nflxext.com"],
    playback: NETFLIX_PLAYBACK,
    addons: [],
    enabledAddons: [],
  };
}
