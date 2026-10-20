export type YouTubeKey = "up" | "down" | "left" | "right" | "ok" | "back";

export type YouTubeEvent =
  | { type: "loaded" }
  | { type: "failed" }
  /** The view navigated; `topLevel` is true on YouTube's home/browse screens. */
  | { type: "route"; topLevel: boolean }
  | { type: "searchOpened" };

/** The YouTube port: the YouTube TV view in production, a fake in tests. */
export interface YouTube {
  /** Shows the view full screen. `note` is a short message overlaid for a few seconds. */
  show(note?: string): void;
  /** Hides the view and pauses playback; it stays loaded. */
  hide(): void;
  sendKey(key: YouTubeKey): void;
  /** Moves YouTube to its search screen if it is not there already. */
  openSearch(): void;
  setSearchText(text: string): void;
  submitSearch(): void;
  playPause(): void;
  restart(): void;
  onEvent(listener: (event: YouTubeEvent) => void): () => void;
}
