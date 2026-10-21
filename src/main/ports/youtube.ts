import type { CommandName } from "../../shared/protocol.ts";
import type { Confirmation } from "../../shared/protocol.ts";
import type { TextEdit } from "../../shared/keyboard.ts";

export type YouTubeKey = "up" | "down" | "left" | "right" | "ok" | "back";

export type YouTubeEvent =
  /** A key pressed on the Mac keyboard while YouTube has focus, already mapped to a command. */
  | { type: "key"; command: CommandName }
  | { type: "loaded" }
  | { type: "failed" }
  /** The view navigated; `home` is true only on YouTube's home screen. */
  | { type: "route"; home: boolean }
  | { type: "searchOpened" }
  /** ⌘F or / on the Mac keyboard: the household wants to type a search with it. */
  | { type: "find" }
  /** A key while text capture is on, already turned into an edit of the search text. */
  | { type: "edit"; edit: TextEdit };

/** The YouTube port: the YouTube TV view in production, a fake in tests. */
export interface YouTube {
  /** Shows the view full screen. `note` is a short message overlaid for a few seconds. */
  show(note?: string): void;
  /** Hides the view and pauses playback; it stays loaded. */
  hide(): void;
  sendKey(key: YouTubeKey): void;
  /** Searches YouTube for the whole text, once (YouTube's search link). */
  submitSearch(text: string): void;
  /** Draws Couch's floating search bar with this text over the view, or removes it when undefined. */
  showSearchBar(text: string | undefined): void;
  /** While on, every key on the Mac keyboard becomes an `edit` event instead of reaching YouTube. */
  captureText(on: boolean): void;
  playPause(): void;
  /** Skips the playing video forward (+) or back (−) by this many seconds. */
  seekBy(seconds: number): void;
  /** Draws the volume level above the view, or removes it when undefined. */
  showVolume(percent: number | undefined): void;
  /** Draws Couch's question over the view, or removes it when undefined. */
  showConfirm(confirm: Confirmation | undefined): void;
  restart(): void;
  onEvent(listener: (event: YouTubeEvent) => void): () => void;
}
