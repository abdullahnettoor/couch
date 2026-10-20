import type { GridItem } from "./protocol.ts";

/** The "YouTube didn't load" screen: one button, OK retries. */
export const YOUTUBE_ERROR_ITEMS: GridItem[] = [
  { id: "retry", r: 0, c: 0, label: "Try again", action: "youtube:retry", initial: true },
];
