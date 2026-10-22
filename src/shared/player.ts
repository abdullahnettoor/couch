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

/** The end-of-video card's two buttons. */
export type NextCardId = "playnext" | "backfolder";

/** One tile in the Up next row. */
export interface UpNextTile {
  title: string;
  line?: string;
  thumb?: string;
  hue: number;
  watched: boolean;
  playing: boolean;
  /** 0-1 while partly watched. */
  progress?: number;
}

/** What the Screen overlay shows on top of the video, drawn by the Screen renderer. */
export interface PlayerOverlay {
  title: string;
  line?: string;
  controls: "hidden" | "dock" | "upnext" | "next";
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
  /** Present while the Up next row shows. */
  upNext?: { tiles: UpNextTile[]; folder: string; focusedIndex?: number };
  /** Present while the end-of-video card shows. */
  next?: { title: string; line?: string; thumb?: string; hue: number; focusedId: NextCardId };
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
  /** Playback speed (mpv's `speed`), 1 = normal. */
  setSpeed(speed: number): Promise<void>;
  /** Couch's own volume, 0-100: mpv's, never the Mac's. */
  setVolume(percent: number): Promise<void>;
  /** Play to this CoreAudio UID, or to the System default when undefined. */
  setAudioDevice(uid: string | undefined): Promise<void>;
  /** Lift the subtitles (mpv draws them) clear of the overlay while it shows. */
  setSubtitlesRaised(raised: boolean, aboveUpNext?: boolean): void;
  getPosition(): Promise<number | undefined>;
  stop(): Promise<void>;
  /** Move the video to the named display, mid-playback if possible. Rejects when it cannot. */
  setDisplay(name: string | undefined): Promise<void>;
  onEvent(listener: (event: PlayerEvent) => void): () => void;
  dispose(): Promise<void>;
}
