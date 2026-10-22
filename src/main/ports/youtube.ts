import type { TrackKind } from "../../shared/protocol.ts";
import type { PlaybackReport } from "../apps/app.ts";
import type { CommandName } from "../../shared/protocol.ts";
import type { Confirmation } from "../../shared/protocol.ts";
import type { TextEdit } from "../../shared/keyboard.ts";

export type YouTubeKey = "up" | "down" | "left" | "right" | "ok" | "back";

export type YouTubeEvent =
  /** A key pressed on the Mac keyboard while YouTube has focus, already mapped to a command. */
  | { type: "key"; command: CommandName }
  | { type: "loaded" }
  /** `note` says why, in words for the App's error screen; without it the screen blames the internet. */
  | { type: "failed"; note?: string }
  /**
   * The view's address, Shorts player or guide changed; `home` is true only on YouTube's home screen.
   * `shorts` and `guideOpen` come from the page (a Short keeps Home's URL).
   */
  | {
      type: "route";
      home: boolean;
      shorts?: boolean;
      guideOpen?: boolean;
      scrolled?: boolean;
      url?: string;
    }
  | { type: "searchOpened" }
  /** Back closed something in the page (a player menu, the bar, a pop-up) without changing its route. */
  | { type: "backHandled" }
  /** What the page is playing, or undefined when nothing is. */
  | { type: "playback"; playback: PlaybackReport | undefined }
  /** The view found (ok) or still can't find the output it was asked for; sent whenever it looks again. */
  | { type: "output"; name: string; ok: boolean }
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
  /** Scrolls the page back to its top; absent for a view that has nothing to scroll. */
  scrollToTop?(): void;
  /** Searches YouTube for the whole text, once (YouTube's search link). */
  submitSearch(text: string): void;
  /** Draws Couch's floating search bar with this text over the view, or removes it when undefined. */
  showSearchBar(text: string | undefined): void;
  /** While on, every key on the Mac keyboard becomes an `edit` event instead of reaching YouTube. */
  captureText(on: boolean): void;
  playPause(): void;
  /** Skips the playing video forward (+) or back (−) by this many seconds. */
  seekBy(seconds: number): void;
  /** Jumps to this position through the App's adapter; does nothing without one. */
  seekTo?(seconds: number): void;
  /** Chooses a track through the App's adapter; does nothing without one. */
  setTrack?(kind: TrackKind, id: string): void;
  /** Draws the volume level above the view, or removes it when undefined. */
  showVolume(percent: number | undefined): void;
  /** Draws Couch's question over the view, or removes it when undefined. */
  showConfirm(confirm: Confirmation | undefined): void;
  /** Couch's own volume, 0-100, for every media element in the view (re-applied when YouTube changes it). */
  setVolume(percent: number): void;
  /**
   * Plays the view's media to the output with this name, or to the System default when undefined.
   * The wanted output is kept and looked for again whenever the page loads, media appears or the
   * output list changes (`output` events report each outcome). Resolves to whether this attempt
   * found it; false means the view keeps the System default for now.
   */
  setOutputDevice(name: string | undefined): Promise<boolean>;
  restart(): void;
  /**
   * Drops the loaded page (the session stays on disk) and forgets where it was: the next `show()`
   * loads it again, and it tells the core it is at its home.
   */
  unload(): void;
  /** Runs exactly these add-ons (by id) from the next page load, and reloads the page now; `note` is overlaid once it has loaded. */
  setAddons(ids: string[], note?: string): void;
  onEvent(listener: (event: YouTubeEvent) => void): () => void;
}
