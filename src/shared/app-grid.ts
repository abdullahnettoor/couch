import type { GridItem } from "./protocol.ts";

/** The "<App> didn't load" screen: one button, OK retries. */
export const APP_ERROR_ITEMS: GridItem[] = [
  { id: "retry", r: 0, c: 0, label: "Try again", action: "app:retry", initial: true },
];
