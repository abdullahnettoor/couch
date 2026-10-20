import type { Command, GridItem, ScreenPayload } from "./protocol.ts";

/** Channel names and payloads between the Screen renderer and the main process. */
export const Channel = {
  /** renderer → main: a keyboard command */
  command: "couch:command",
  /** renderer → main: the grid of focusable items it drew */
  grid: "couch:grid",
  /** main → renderer: what to draw */
  screen: "couch:screen",
  /** main → renderer: mpv state, for the "needs mpv" notice */
  mpv: "couch:mpv",
} as const;

export interface GridReport {
  viewKey: string;
  items: GridItem[];
}

export interface CouchApi {
  send(command: Command): void;
  reportGrid(report: GridReport): void;
  onScreen(listener: (payload: ScreenPayload) => void): void;
  onMpv(listener: (status: { missing: boolean; message?: string }) => void): void;
}
