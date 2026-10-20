import type { YouTube } from "./youtube.ts";

/** Stand-in for tests and runs without a window. */
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
