import type { YouTube } from "./youtube.ts";

/** Stand-in until the YouTube view exists (ticket 005). */
export const nullYouTube: YouTube = {
  show() {},
  hide() {},
  sendKey() {},
  setSearchText() {},
  submitSearch() {},
  playPause() {},
  restart() {},
  onEvent: () => () => {},
};
