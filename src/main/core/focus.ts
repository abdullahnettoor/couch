import type { GridItem } from "../../shared/protocol.ts";

export type Direction = "up" | "down" | "left" | "right";

/** The item the focus cell points at, or the view's initial (else first) item. */
export function resolveFocus(
  grid: GridItem[],
  cell: { r: number; c: number } | undefined,
): GridItem | undefined {
  if (grid.length === 0) return undefined;
  const exact = cell && grid.find((i) => i.r === cell.r && i.c === cell.c);
  if (exact) return exact;
  return grid.find((i) => i.initial) ?? [...grid].sort((a, b) => a.r - b.r || a.c - b.c)[0];
}

/**
 * Left/Right move within the row. Up/Down jump to the nearest row in that
 * direction and the nearest column within it. At an edge, focus stays put.
 */
export function moveFocus(grid: GridItem[], current: GridItem, direction: Direction): GridItem {
  if (direction === "left" || direction === "right") {
    const sign = direction === "right" ? 1 : -1;
    const next = grid
      .filter((i) => i.r === current.r && (i.c - current.c) * sign > 0)
      .sort((a, b) => Math.abs(a.c - current.c) - Math.abs(b.c - current.c))[0];
    return next ?? current;
  }
  const sign = direction === "down" ? 1 : -1;
  const rows = grid
    .map((i) => i.r)
    .filter((r) => (r - current.r) * sign > 0)
    .sort((a, b) => Math.abs(a - current.r) - Math.abs(b - current.r));
  if (rows.length === 0) return current;
  const row = grid.filter((i) => i.r === rows[0]);
  return row.sort((a, b) => Math.abs(a.c - current.c) - Math.abs(b.c - current.c))[0]!;
}
