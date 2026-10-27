import type { GridItem } from "./protocol.ts";

/** One column; rows follow the order given. The first row starts focused. */
function column(items: Array<Omit<GridItem, "r" | "c">>): GridItem[] {
  return items.map((item, r) => ({ ...item, r, c: 0, ...(r === 0 ? { initial: true } : {}) }));
}

export const SETTINGS_APP = "settings:app:";

/** Settings: six rows, each a group page except Quit. */
export const SETTINGS_ITEMS: GridItem[] = column([
  { id: "remotes", label: "Remotes and Devices", action: "settings:remotes" },
  { id: "library", label: "Library", action: "settings:library" },
  { id: "sound", label: "Sound output", action: "settings:sound" },
  { id: "apps", label: "Apps", action: "settings:apps" },
  { id: "home", label: "Home", action: "settings:home" },
  { id: "quit", label: "Quit Couch", action: "settings:quit" },
]);

export const REMOTES_ITEMS: GridItem[] = column([
  { id: "add-phone", label: "Add a phone", action: "settings:add-phone" },
  { id: "forget-phones", label: "Forget all phones", action: "settings:forget-phones" },
  { id: "listener", label: "Start Couch Listener at login", action: "settings:listener" },
]);

export const LIBRARY_ITEMS: GridItem[] = column([
  { id: "library-folders", label: "Library folders", action: "settings:library-folders" },
  { id: "details", label: "Show and film details", action: "settings:details" },
]);

/** Add a phone: a single Done button under the QR code. */
export const ADD_PHONE_ITEMS: GridItem[] = [
  { id: "done", r: 0, c: 0, label: "Done", action: "back", initial: true },
];
