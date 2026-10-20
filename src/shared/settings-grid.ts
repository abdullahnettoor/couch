import type { GridItem } from "./protocol.ts";

type SettingsItem = Omit<GridItem, "r" | "c">;

/** Settings' items in display order, one per line. Later tickets insert theirs (and add the action in core/actions.ts). */
const ITEMS: SettingsItem[] = [
  { id: "add-phone", label: "Add a phone", action: "settings:add-phone", initial: true },
  { id: "forget-phones", label: "Forget all phones", action: "settings:forget-phones" },
  { id: "library-folders", label: "Library folders", action: "settings:library-folders" },
  { id: "quit", label: "Quit Couch", action: "settings:quit" },
];

/** A single column; rows follow the order above. */
export const SETTINGS_ITEMS: GridItem[] = ITEMS.map((item, r) => ({ ...item, r, c: 0 }));

/** Add a phone: a single Done button under the QR code. */
export const ADD_PHONE_ITEMS: GridItem[] = [
  { id: "done", r: 0, c: 0, label: "Done", action: "back", initial: true },
];
