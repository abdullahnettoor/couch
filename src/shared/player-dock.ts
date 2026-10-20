/** The player's dock: one grid row. Ticket 020's Up next row goes above it (row 0), so the dock sits on row 1. */
export const DOCK_ROW = 1;

export type DockId =
  | "playpause"
  | "back10"
  | "fwd10"
  | "bar"
  | "upnext"
  | "subtitles"
  | "volicon"
  | "volume";

/** In dock order; the index is the grid column. */
export const DOCK_IDS: readonly DockId[] = [
  "playpause",
  "back10",
  "fwd10",
  "bar",
  "upnext",
  "subtitles",
  "volicon",
  "volume",
];

export const DOCK_LABELS: Record<DockId, string> = {
  playpause: "Play / pause",
  back10: "Back 10 seconds",
  fwd10: "Forward 10 seconds",
  bar: "Progress",
  upnext: "Up next",
  subtitles: "Subtitles",
  volicon: "Volume",
  volume: "Volume level",
};
