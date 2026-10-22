import type {
  CommandName,
  Confirmation,
  RemoteLayout,
  PromptId,
  TrackKind,
  TrackList,
} from "../../shared/protocol.ts";
import type { TextEdit } from "../../shared/keyboard.ts";

export type AppKey = "up" | "down" | "left" | "right" | "ok" | "back";

/** What a web App's page is playing now, as the shared playback layer reads it. */
export interface PlaybackReport {
  /** Whole seconds. */
  position: number;
  duration: number;
  paused: boolean;
  title?: string;
  artwork?: string;
  /** Present when the App's adapter can list them. */
  tracks?: { subtitles: TrackList; audio: TrackList };
  /** The App's own button over the video right now; absent when none is showing. */
  prompt?: { id: PromptId; label: string };
  /** The App can seek to a point (its adapter's seek works); false or absent: key-based skips only. */
  canSeek?: boolean;
}

/** What a web App tells core. Anything about its own pages (routes, Shorts...) stays inside the App. */
export type AppEvent =
  /** A key pressed on the Mac keyboard while the App has focus, already mapped to a command. */
  | { type: "key"; command: CommandName }
  | { type: "loaded" }
  /** `note` says why, in words for the App's error screen; without it the screen blames the internet. */
  | { type: "failed"; note?: string }
  | { type: "searchOpened" }
  /** What the page is playing, or undefined when nothing is; sent whenever it changes. */
  | { type: "playback"; playback: PlaybackReport | undefined }
  /** The view found (ok) or still can't find the output it was asked for; sent whenever it looks again. */
  | { type: "output"; name: string; ok: boolean }
  /** ⌘F or / on the Mac keyboard: the household wants to type a search with it. */
  | { type: "find" }
  /** A key while text capture is on, already turned into an edit of the search text. */
  | { type: "edit"; edit: TextEdit };

/** Something that plays sound through the Sound output setting (mpv and every web App). */
export interface SoundSink {
  readonly id: string;
  readonly label: string;
  /** Couch's own volume, 0-100. */
  setVolume(percent: number): void;
  /**
   * Plays to the output with this name, or to the System default when undefined. Resolves to
   * whether this attempt found it; false means the App keeps the System default for now.
   */
  setOutputDevice(name: string | undefined): Promise<boolean>;
}

/** An App that takes text: the Remote's Type button and the Mac keyboard search. */
export interface AppTyping {
  /** The Remote's Type button label, e.g. "Search YouTube". */
  readonly label: string;
  /** Searches the App for the whole text, once. */
  submitSearch(text: string): void;
  /** Draws Couch's floating search bar with this text over the App, or removes it when undefined. */
  showSearchBar(text: string | undefined): void;
  /** While on, every key on the Mac keyboard becomes an `edit` event instead of reaching the App. */
  captureText(on: boolean): void;
}

/**
 * A web App: a full-screen web view core hands the Screen to. While it is the front App, core
 * sends it the D-pad, OK, Back, play/pause, seek and typing; everything App-specific lives behind this.
 */
export interface App extends SoundSink {
  /** Present when the App takes text; without it the Remote shows no Type button. */
  readonly typing?: AppTyping;
  /** Which control layout the Remote shows while the App is in front; "app" when absent. */
  readonly layout?: RemoteLayout;
  /** The Remote shows its volume −/+ pair. */
  readonly showVolume: boolean;
  /** The Remote shows its −10 s / +10 s pair. */
  readonly showSkip: boolean;
  /** Shows the App full screen. `note` is a short message overlaid for a few seconds. */
  show(note?: string): void;
  /** Hides the App and pauses playback; it stays loaded. */
  hide(): void;
  /** Up, down, left, right and OK. Back goes through `back()`. */
  sendKey(key: AppKey): void;
  /**
   * Back pressed. "leave": the App is at its home, so core asks "Leave <label>?";
   * "handled": the App went back by itself.
   */
  back(): "leave" | "handled";
  /** Absent for an App with nothing to play or pause. */
  playPause?(): void;
  /** Skips the playing video forward (+) or back (−) by this many seconds; absent when it can't. */
  seekBy?(seconds: number): void;
  /** Jumps to this position in the playing video; absent when the App's adapter can't. */
  seekTo?(seconds: number): void;
  /** Chooses a subtitle or audio track by the id its report listed; absent when the adapter can't. */
  setTrack?(kind: TrackKind, id: string): void;
  /** Presses the App's own prompt button (as the report listed it); absent when the adapter has none. */
  pressPrompt?(id: PromptId): void;
  /** Draws the volume level above the App, or removes it when undefined. */
  drawVolume(percent: number | undefined): void;
  /** Draws Couch's question over the App, or removes it when undefined. */
  showConfirm(confirm: Confirmation | undefined): void;
  restart(): void;
  /** Web Apps with add-ons: run exactly these (by id) and reload the page, then show `note` over it. */
  setAddons?(ids: string[], note?: string): void;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
