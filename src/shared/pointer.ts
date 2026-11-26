/** The pointer: the arrow Couch draws on the Screen while a phone is in Pointer mode. Shared by the core, the main process and the Screen renderer. */

/** Pointer styles Couch can draw; one today, modelled so a dot or ring can join it (see `Look.pointer`). */
export type PointerStyleName = "arrow";

/** What to draw: the pointer's place in the Screen's content coordinates, and whether it shows. */
export interface PointerDraw {
  x: number;
  y: number;
  shown: boolean;
  style: PointerStyleName;
}

/** The layer that gets a pointer event: only the one in front. */
export type PointerLayer = "page" | "quick" | "app";

/** A pointer event for one layer, at a point of the Screen's content. */
export type PointerInput = { layer: PointerLayer; x: number; y: number } & (
  | { type: "move" }
  | { type: "click" }
  | { type: "rightClick" }
  | { type: "scroll"; dx: number; dy: number }
);

/** What a web App takes from the pointer: the same events a mouse would make over its page, at a point of the window. */
export interface AppPointer {
  move(x: number, y: number): void;
  click(x: number, y: number): void;
  rightClick(x: number, y: number): void;
  scroll(x: number, y: number, dx: number, dy: number): void;
  /** Pointer mode is on (true) or off for this App: lifts or restores the page's D-pad shield. */
  setMode(on: boolean): void;
}

export const POINTER_SPEEDS = ["slow", "normal", "fast"] as const;
export type PointerSpeed = (typeof POINTER_SPEEDS)[number];
