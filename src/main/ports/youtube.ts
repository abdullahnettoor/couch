export type YouTubeKey = "up" | "down" | "left" | "right" | "ok" | "back";

export type YouTubeEvent =
  | { type: "loaded" }
  | { type: "failed" }
  | { type: "topLevel" }
  | { type: "searchOpened" };

/** The YouTube port: the YouTube TV view in production, a fake in tests. */
export interface YouTube {
  show(): void;
  /** Hides the view and pauses playback; it stays loaded. */
  hide(): void;
  sendKey(key: YouTubeKey): void;
  setSearchText(text: string): void;
  submitSearch(): void;
  playPause(): void;
  restart(): void;
  onEvent(listener: (event: YouTubeEvent) => void): () => void;
}
