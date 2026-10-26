import type { Command } from "../shared/protocol.ts";
import { Channel } from "../shared/ipc.ts";

/** Volume buttons the drawer's page draws inside the Volume row. */
const VOLUME_PICKS = ["vol:down", "vol:up", "vol:mute"];

/**
 * What the drawer's page may ask for: a pick of a row it was given (or a Volume button), or a close.
 * Anything else, or anything malformed, is nothing.
 */
export function quickCommandFrom(raw: unknown, ids: readonly string[]): Command | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const { command, args, ...extra } = raw as Record<string, unknown>;
  if (Object.keys(extra).length) return undefined;
  if (command === "quickClose") return args === undefined ? { command } : undefined;
  if (command !== "quickPick") return undefined;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const keys = Object.keys(args);
  const item = (args as Record<string, unknown>).item;
  if (keys.length !== 1 || keys[0] !== "item" || typeof item !== "string") return undefined;
  if (!ids.includes(item) && !(ids.includes("vol") && VOLUME_PICKS.includes(item)))
    return undefined;
  return { command, args: { item } };
}

export interface QuickIpc {
  on(channel: string, handler: (event: { sender: unknown }, raw: unknown) => void): void;
  /** Whether the message came from the drawer's own page. */
  isDrawer(sender: unknown): boolean;
  /** The rows on the drawer now. */
  ids(): readonly string[];
  send(command: Command): void;
  /** The drawer's panel has just started sliding in or out. */
  slide(phase: "in" | "out"): void;
}

export function wireQuickIpc(ipc: QuickIpc): void {
  ipc.on(Channel.quickCommand, (event, raw) => {
    if (!ipc.isDrawer(event.sender)) return;
    const command = quickCommandFrom(raw, ipc.ids());
    if (command) ipc.send(command);
  });
  ipc.on(Channel.quickSlide, (event, raw) => {
    if (!ipc.isDrawer(event.sender)) return;
    if (raw === "in" || raw === "out") ipc.slide(raw);
  });
}
