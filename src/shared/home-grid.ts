import type { GridItem } from "./protocol.ts";

/** Home's focusable items. The renderer draws these and reports them to the core. */
export const HOME_ITEMS: GridItem[] = [
  { id: "settings", r: 0, c: 0, label: "Settings", action: "open:settings" },
  { id: "youtube", r: 1, c: 0, label: "YouTube", action: "open:youtube", initial: true },
  { id: "library", r: 1, c: 1, label: "Library", action: "open:library" },
];
