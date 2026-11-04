import type {
  GridItem,
  ScreenPayload,
  ScreenState,
  UiSound,
  View,
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
  /** Focus movement for a Page with its own rules; otherwise the core moves focus over `grid()`. */
  move?(direction: Direction): void;
  /** The view just changed to one of this Page's views. */
  enter?(from: View): void;
  /** The view is about to change from one of this Page's views. */
  leave?(to: View): void;
}

/** What `Core` hands to each Page. The state is read-only: the type checker refuses a write to `state.view`. */
export interface PageContext {
  readonly state: Readonly<ScreenState>;
  /** Changes view through the core's one view-change path. */
  go(view: View): void;
  toast(text: string): void;
  /** The confirm question. */
  ask(title: string, buttons: string[], answers: Array<() => void>, more?: { body: string }): void;
  /** Plays an Interface sound. */
  cue(sound: UiSound): void;
  /** Tells the Screen and phones the state changed. */
  emit(): void;
}
