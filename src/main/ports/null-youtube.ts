import type { YouTube } from "./youtube.ts";

/** Stand-in for tests and runs without a window. */
export const nullYouTube: YouTube = {
  show() {},
  hide() {},
  sendKey() {},
  submitSearch() {},
  showSearchBar() {},
  captureText() {},
  playPause() {},
  seekBy() {},
  showVolume() {},
  setVolume() {},
  setOutputDevice: () => Promise.resolve(true),
  restart() {},
  onEvent: () => () => {},
};
