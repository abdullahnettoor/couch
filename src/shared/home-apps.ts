import type { ScreenPayload } from "./protocol.ts";

/** The Show on Home switch for one App row: on, off, or undefined when Home doesn't list the App. */
export function homeAppSwitch(
  rows: ScreenPayload["homeApps"],
  id: string,
): "on" | "off" | undefined {
  const row = rows?.find((r) => r.id === id);
  return row ? (row.shown ? "on" : "off") : undefined;
}
