import {
  VIEW_LABELS,
  type GridItem,
  type RemoteId,
  type ScreenPayload,
  type ScreenState,
  type UiSound,
  type View,
} from "../../../shared/protocol.ts";
import type { Source } from "../core.ts";

type Direction = "up" | "down" | "left" | "right";

/** What Back does on a Page. `label` is the "‹ Settings" text; `act` goes there. */
export interface PageBack {
  label?: string;
  act(): void;
}

/**
 * One of Couch's own full-screen places on the Screen. One file per Page owns everything about it:
 * the grid, the payload fields it fills, the actions it handles, what Back does, and entering and leaving.
 * Several views can share one Page object. A Page never writes the view: it calls `ctx.go(view)`.
 */
export interface Page {
  /** The items the D-pad moves between. */
  grid(): GridItem[];
  /** Only the payload fields this Page fills; `Core.screen()` spreads it. `focused` is the focused grid item's id. */
  payload(focused?: string): Partial<ScreenPayload>;
  /** Handles an action string, or returns false when it isn't this Page's. */
  action(action: string, source?: Source): boolean;
  /** Undefined: Back is ignored here. */
  back(): PageBack | undefined;
  /** The key this Page's focus is kept under, when it isn't just the view (a menu over the page has its own). */
  focusKey?(): string | undefined;
  /** Focus movement for a Page with its own rules; otherwise the core moves focus over `grid()`. */
  move?(direction: Direction): void;
  /** A Page that hands keys to something else (an App's website) takes them here; true when it did. */
  press?(key: Direction | "ok"): boolean;
  /** False: a pointer can't put focus on this Page's items now (the player's hidden controls, an App). */
  pointable?(): boolean;
  /** The view just changed to one of this Page's views. `returning`: coming back to where the household was (from playback or Fix match), not arriving fresh. */
  enter?(from: View, returning?: boolean): void;
  /** The view was asked for while it is already this Page's. */
  reenter?(): void;
  /** The view is about to change from one of this Page's views. */
  leave?(to: View): void;
}

/** What `Core` hands to each Page. The state is read-only: the type checker refuses a write to `state.view`. */
export interface PageContext {
  readonly state: Readonly<ScreenState>;
  /** Changes view through the core's one view-change path. `returning`: going back to where the household was, so Home keeps its focus and hero and the idle timer isn't restarted. */
  go(view: View, options?: { returning?: true }): void;
  toast(text: string): void;
  /** The confirm question. */
  ask(
    title: string,
    buttons: string[],
    answers: Array<() => void>,
    more?: { body?: string; back?: () => void; phone?: true },
  ): void;
  /** The focus kept under a focus key. Only this Page's own keys; any other throws. */
  focusOf(key: string): { r: number; c: number } | undefined;
  /** The key of the current view's focus (a folder has one per path). */
  viewKey(): string;
  /** Starts a typing session for a Page's own purpose; `by` is the phone, or the Screen. */
  startTyping(by: RemoteId, purpose: "librarySearch" | "tmdbKey"): void;
  /** Ends the typing session without cancelling anything. */
  stopTyping(): void;
  /** Plays an Interface sound. */
  cue(sound: UiSound): void;
  /** Tells the Screen and phones the state changed. */
  emit(): void;
  /** Sets (or, with no cell, forgets) the focus kept under one of this Page's own focus keys. */
  setFocus(key: string, at?: { r: number; c: number }): void;
}

/** Back that goes to `view`, labelled with its name ("‹ Settings"). */
export function backTo(ctx: PageContext, view: View): PageBack {
  return { label: VIEW_LABELS[view], act: () => ctx.go(view) };
}

/** The show Page's and Fix match's own state, besides the view. */
export interface ShowContext extends PageContext {
  setShow(id: string): void;
  setShowTab(tab: string | undefined): void;
}

/** The folder's own state, besides the view. */
export interface FolderContext extends PageContext {
  setFolder(path: string): void;
}

/** The App Pages' own state: which App is on the Screen, and the note under an error. */
export interface AppContext extends PageContext {
  setApp(id: string | undefined, note?: string): void;
}
