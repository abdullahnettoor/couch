import type { CommandName, Confirmation } from "../../shared/protocol.ts";
import type { TextEdit } from "../../shared/keyboard.ts";

export type AppKey = "up" | "down" | "left" | "right" | "ok" | "back";

/** What a web App tells core. Anything about its own pages (routes, Shorts...) stays inside the App. */
export type AppEvent =
  /** A key pressed on the Mac keyboard while the App has focus, already mapped to a command. */
  | { type: "key"; command: CommandName }
  | { type: "loaded" }
  | { type: "failed" }
  | { type: "searchOpened" }
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

/**
 * A web App: a full-screen web view core hands the Screen to. While it is the front App, core
 * sends it the D-pad, OK, Back, play/pause, seek and typing; everything App-specific lives behind this.
 */
export interface App extends SoundSink {
  /** The Remote's Type button label, e.g. "Search YouTube". */
  readonly typeLabel: string;
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
  /** Searches the App for the whole text, once. */
  submitSearch(text: string): void;
  /** Draws Couch's floating search bar with this text over the App, or removes it when undefined. */
  showSearchBar(text: string | undefined): void;
  /** While on, every key on the Mac keyboard becomes an `edit` event instead of reaching the App. */
  captureText(on: boolean): void;
  playPause(): void;
  /** Skips the playing video forward (+) or back (−) by this many seconds. */
  seekBy(seconds: number): void;
  /** Draws the volume level above the App, or removes it when undefined. */
  drawVolume(percent: number | undefined): void;
  /** Draws Couch's question over the App, or removes it when undefined. */
  showConfirm(confirm: Confirmation | undefined): void;
  restart(): void;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
