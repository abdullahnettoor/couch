import type { FocusLayout } from "../../web/page-focus.ts";

/** A Settings switch row: its checkbox is a small box inside a full-width label, so the row is the stop. */
const SWITCH_ROW = 'main label:has(> input[type="checkbox"])';

/** BitChord's own controls beyond the host's defaults (links, buttons, roles). */
export const BITCHORD_FOCUS_SELECTORS: string[] = [SWITCH_ROW];

/** A song row: a shelf's (`group/track`) or a table's (`group/row`). */
const TRACK = '[class*="group/track"], [class*="group/row"]';
const inTracks = (inner: string) =>
  TRACK.split(", ")
    .map((t) => `${t} ${inner}`)
    .join(", ");

/** How BitChord is laid out: a sidebar and a player bar that stay put, and a page of shelves and track tables that scrolls between them. */
export const BITCHORD_LAYOUT: FocusLayout = {
  // BitChord's own arrow shortcuts (volume, seeking) are Couch's to set; the arrows move the highlight.
  takeArrows: true,
  startFirst: true,
  ringAround: `${TRACK}, ${SWITCH_ROW}`,
  docks: ['nav[aria-label="Main"]', '[role="region"][aria-label="Player"]'],
  ignore: [
    // The shelves' paging arrows: the highlight scrolls a shelf by itself.
    'button[aria-label$="Page"]',
    // A card is its artwork link (named by the title); the title's own link under it says the same.
    'a[href^="/album/"]:not([aria-label])',
    'a[href^="/playlist/"]:not([aria-label])',
    // Volume is Couch's own: the Remote sets it.
    'input[type="range"]',
    // A song row is its Play button: its menu, title, artists and album link are for a mouse.
    'button[aria-label^="More options"]',
    ...inTracks("a").split(", "),
    ...inTracks("button:not([aria-label])").split(", "),
    'main label > input[type="checkbox"]',
    // Out of scope (#50), or a file Couch never saves: downloads, GitHub and Listen Together.
    'a[href*="/downloads/"]',
    'a[href^="https://github.com/"]',
    'a[href="/settings/listen-together"]',
  ],
};
