import type { CommandName } from "./protocol.ts";

export type PlayerEvent =
  | { type: "position"; seconds: number }
  | { type: "pause"; paused: boolean }
  | { type: "duration"; seconds: number }
  | { type: "ended"; reason: "eof" | "stop" | "error" }
  | { type: "exited" }
  | { type: "missing" }
  /** A Screen key pressed while the video window has keyboard focus. */
  | { type: "key"; command: CommandName };

export interface LoadOptions {
  startSeconds?: number;
  /** Whether subtitles start visible (they still need a track to show). */
  subtitles?: boolean;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** What the Screen overlay shows on top of the video, drawn by the Screen renderer. */
export interface PlayerOverlay {
  title: string;
  controls: "hidden" | "dock";
  /** Present while the dock is shown. */
  dock?: {
    position: number;
    duration: number;
    subtitlesOn: boolean;
    /** Current volume 0-100, for the dock's slider. */
    level: number;
    /** Id of the focused dock item (a DockId). */
    focusedId?: string;
    /** Ticket 020: the Up next control is enabled. */
    upNext: boolean;
  };
  paused: boolean;
  /** A short note, e.g. "Resumed at 40:10". */
  note?: string;
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
  /** Lift the subtitles (mpv draws them) clear of the overlay while it shows. */
  setSubtitlesRaised(raised: boolean): void;
  getPosition(): Promise<number | undefined>;
  stop(): Promise<void>;
  /** Move the video to the named display, mid-playback if possible. Rejects when it cannot. */
  setDisplay(name: string | undefined): Promise<void>;
  onEvent(listener: (event: PlayerEvent) => void): () => void;
  dispose(): Promise<void>;
}
