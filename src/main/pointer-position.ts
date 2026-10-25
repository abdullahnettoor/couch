export interface Point {
  x: number;
  y: number;
}
export interface Bounds extends Point {
  width: number;
  height: number;
}

/** A screen pointer as the position inside the window's content bounds; undefined when it is outside them. */
export function screenPointer(
  p: Point,
  content: Bounds,
): { x: number; y: number; width: number } | undefined {
  const x = p.x - content.x;
  const y = p.y - content.y;
  if (x < 0 || y < 0 || x >= content.width || y >= content.height) return undefined;
  return { x, y, width: content.width };
}
