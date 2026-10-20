export type PlayerEvent =
  | { type: "position"; seconds: number }
  | { type: "pause"; paused: boolean }
  | { type: "duration"; seconds: number }
  | { type: "ended"; reason: "eof" | "stop" | "error" }
  | { type: "exited" }
  | { type: "missing" };

export interface LoadOptions {
  startSeconds?: number;
}

/** The Player port: mpv in production, a fake in tests. */
export interface Player {
  load(path: string, options?: LoadOptions): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  seekBy(seconds: number): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  getPosition(): Promise<number | undefined>;
  stop(): Promise<void>;
  onEvent(listener: (event: PlayerEvent) => void): () => void;
  dispose(): Promise<void>;
}
