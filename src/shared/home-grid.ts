import type { GridItem } from "./protocol.ts";

/** Home's focusable items: the gear, then one tile per App. The core builds these from its App catalog. */
export function homeItems(
  entries: Array<{ id: string; label: string; action: string }>,
): GridItem[] {
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
