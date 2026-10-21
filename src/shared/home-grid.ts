import { APP_ENTRIES, type AppEntry } from "../main/apps/index.ts";
import type { GridItem } from "./protocol.ts";

/** Home's focusable items: the gear, then one tile per App. The renderer draws these and reports them to the core. */
export function homeItems(entries: AppEntry[]): GridItem[] {
  return [
    { id: "settings", r: 0, c: 0, label: "Settings", action: "open:settings" },
    ...entries.map((app, c) => ({
      id: app.id,
      r: 1,
      c,
      label: app.label,
      action: app.action,
      ...(c === 0 ? { initial: true } : {}),
    })),
  ];
}

export const HOME_ITEMS: GridItem[] = homeItems(APP_ENTRIES);
