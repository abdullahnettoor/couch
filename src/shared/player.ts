export type PlayerEvent =
  | { type: "position"; seconds: number }
  | { type: "pause"; paused: boolean }
  | { type: "duration"; seconds: number }
  | { type: "ended"; reason: "eof" | "stop" | "error" }
  | { type: "exited" }
  | { type: "missing" };

export interface LoadOptions {
  startSeconds?: number;
  /** Whether subtitles start visible (they still need a track to show). */
  subtitles?: boolean;
}

/** What the Screen overlay shows on top of the video, drawn by the player itself. */
export interface PlayerOverlay {
  title: string;
  /** Present while the progress bar is shown. */
  bar?: { position: number; duration: number };
  paused: boolean;
  /** Present while the volume level indicator is shown (0-100). */
  volume?: number;
}

/** The Player port: mpv in production, a fake in tests. */
export interface Player {
  load(path: string, options?: LoadOptions): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  seekBy(seconds: number): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  setSubtitles(visible: boolean): Promise<void>;
  /** Draw (or with undefined, clear) the overlay on the video. */
  setOverlay(overlay: PlayerOverlay | undefined): void;
  getPosition(): Promise<number | undefined>;
  stop(): Promise<void>;
  onEvent(listener: (event: PlayerEvent) => void): () => void;
  dispose(): Promise<void>;
}
