import type { FocusLayout } from "../../web/page-focus.ts";

/** BitChord's own controls beyond the host's defaults (links, buttons, roles). */
export const BITCHORD_FOCUS_SELECTORS: string[] = [];

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
  ringAround: TRACK,
  docks: ['nav[aria-label="Main"]', '[role="region"][aria-label="Player"]'],
  // Every ⋯ menu (a song's, the lyrics provider's, the video quality's); the full view is already role=dialog.
  scopes: ['[role="menu"]'],
  // Inside a menu BitChord moves its own focus with the arrows: the ring follows it, so OK presses what the ring is on.
  followFocus: true,
  // The checked item of a menu, else its first; in the full view, Pause, else Play (BitChord itself focuses Close).
  modalEntry: [
    '[role="menu"] [role^="menuitem"][aria-checked="true"]',
    '[role="menu"] [role^="menuitem"]',
    '[aria-label="Now Playing"] section[aria-label="Player"] button[aria-label="Pause"]',
    '[aria-label="Now Playing"] section[aria-label="Player"] button[aria-label="Play"]',
  ],
  ignore: [
    // The shelves' paging arrows: the highlight scrolls a shelf by itself.
    'button[aria-label$="Page"]',
    // A card is its artwork link (named by the title); the title's own link under it says the same.
    'a[href^="/album/"]:not([aria-label])',
    'a[href^="/playlist/"]:not([aria-label])',
    // Volume is Couch's own: the Remote sets it.
    'input[type="range"]',
    // A song row is its Play button: its menu, title, artists and album link are for a mouse (the bar's and the full view's ⋯ are not rows).
    ...inTracks('button[aria-label^="More options"]').split(", "),
    'aside button[aria-label^="More options"]',
    // Couch is already full screen, and BitChord's own does nothing from a key.
    'button[aria-label="Enter full screen"]',
    // The full view's title, album and artists lead out of it: its controls are what the ring is for.
    '[aria-label="Now Playing"] a[href]',
    '[aria-label="Now Playing"] section[aria-label="Player"] button:not([aria-label])',
    // Shown only under a mouse: the ring would outline nothing.
    '[aria-label="Now Playing"] section[aria-label="Lyrics"] button',
    ...inTracks("a").split(", "),
    ...inTracks("button:not([aria-label])").split(", "),
  ],
};
