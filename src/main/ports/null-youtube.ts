import type { YouTube } from "./youtube.ts";

/** Stand-in for tests and runs without a window. */
export const nullYouTube: YouTube = {
  show() {},
  hide() {},
  sendKey() {},
  openSearch() {},
  setSearchText() {},
  submitSearch() {},
  playPause() {},
  showVolume() {},
  restart() {},
  onEvent: () => () => {},
};
