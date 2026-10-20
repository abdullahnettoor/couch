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
  /** renderer → main: where the dock / Up next row are, for native glass behind them */
  glass: "couch:glass",
  /** main → renderer: the video's main colour, for the tinted fallback */
  tint: "couch:tint",
} as const;

export interface GridReport {
  viewKey: string;
  items: GridItem[];
}

/** A glass panel's rectangle in window (CSS) pixels, corner radius and opacity (0 hides it). */
export interface GlassRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  alpha: number;
}

export interface MpvStatus {
  missing: boolean;
  message?: string;
  /** Native Liquid Glass sits behind the dock; otherwise the renderer tints it. */
  nativeGlass?: boolean;
}

export interface CouchApi {
  send(command: Command): void;
  reportGrid(report: GridReport): void;
  onScreen(listener: (payload: ScreenPayload) => void): void;
  onMpv(listener: (status: MpvStatus) => void): void;
  /** One entry per panel slot (0 dock, 1 Up next); missing slots are hidden. */
  reportGlass(rects: GlassRect[]): void;
  onTint(listener: (rgb: [number, number, number] | null) => void): void;
}
