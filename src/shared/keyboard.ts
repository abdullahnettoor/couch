import type { CommandName } from "./protocol.ts";

/** The Mac keyboard's keys on the Screen, by KeyboardEvent.key. Backspace is left alone for typing. */
export const SCREEN_KEYS: Record<string, CommandName> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "ok",
  Escape: "back",
  h: "home",
  H: "home",
  " ": "playpause",
};
