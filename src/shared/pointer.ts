import type { Look } from "./look.ts";

/** The pointer: the arrow Couch draws on the Screen while a phone is in Pointer mode. Shared by the core, the main process and the Screen renderer. */

/** Pointer styles Couch can draw; one today, modelled so a dot or ring can join it (see `Look.pointer`). */
export type PointerStyleName = "arrow";

/** What to draw: the pointer's place in the Screen's content coordinates, and whether it shows. */
export interface PointerDraw {
  x: number;
  y: number;
  shown: boolean;
  style: PointerStyleName;
}

/** The layer that gets a pointer event: only the one in front. */
export type PointerLayer = "page" | "quick" | "app";

/** A pointer event for one layer, at a point of the Screen's content. */
export type PointerInput = { layer: PointerLayer; x: number; y: number } & (
  | { type: "move" }
  | { type: "click" }
  | { type: "rightClick" }
  | { type: "scroll"; dx: number; dy: number }
);

/** What a web App takes from the pointer: the same events a mouse would make over its page, at a point of the window. */
export interface AppPointer {
  move(x: number, y: number): void;
  click(x: number, y: number): void;
  rightClick(x: number, y: number): void;
  scroll(x: number, y: number, dx: number, dy: number): void;
  /** Pointer mode is on (true) or off for this App: lifts or restores the page's D-pad shield. */
  setMode(on: boolean): void;
}

export const POINTER_SPEEDS = ["slow", "normal", "fast"] as const;
export type PointerSpeed = (typeof POINTER_SPEEDS)[number];

/** A CSS `rgb()` or `rgba()` colour as [r, g, b, a] with every part 0–1; opaque black when it isn't one. */
export function parseRgba(css: string): [number, number, number, number] {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    css.trim(),
  );
  if (!m) return [0, 0, 0, 1];
  return [
    Number(m[1]) / 255,
    Number(m[2]) / 255,
    Number(m[3]) / 255,
    m[4] === undefined ? 1 : Number(m[4]),
  ];
}

/** The pointer's style in the window's own pixels: what the native overlay draws, from the Look. */
export interface PointerPixels {
  /** The arrow's outline in pixels from its tip, y down. */
  points: [number, number][];
  height: number;
  fill: [number, number, number, number];
  stroke: [number, number, number, number];
  strokeWidth: number;
  shadow: { color: [number, number, number, number]; blur: number; drop: number };
}

/** The Look's pointer scaled to a window `width` pixels wide (the Look is written for its design width). */
export function pointerPixels(look: Look, width: number): PointerPixels {
  const arrow = look.pointer.styles[look.pointer.style];
  const k = width / look.metrics.base.width;
  const height = arrow.size * k;
  return {
    points: arrow.points.map(([x, y]) => [x * height, y * height]),
    height,
    fill: parseRgba(arrow.fill),
    stroke: parseRgba(arrow.stroke),
    strokeWidth: arrow.strokeWidth * k,
    shadow: {
      color: parseRgba(arrow.shadow.color),
      blur: arrow.shadow.blur * k,
      drop: arrow.shadow.drop * k,
    },
  };
}

/**
 * The pointer as inline SVG for the Screen's renderer (the fallback where the native overlay isn't there): sized in the
 * Screen's unit (`--u`), with its tip at the element's top-left corner.
 */
export function pointerSvg(look: Look): string {
  const arrow = look.pointer.styles[look.pointer.style];
  const { size, strokeWidth, shadow } = arrow;
  const width = Math.max(...arrow.points.map(([x]) => x)) * size;
  const pad = strokeWidth + shadow.blur + shadow.drop;
  const points = arrow.points.map(([x, y]) => `${x * size},${y * size}`).join(" ");
  const box = [-pad, -pad, width + pad * 2, size + pad * 2];
  const px = (n: number) => `calc(${n} * var(--u))`;
  return (
    `<svg class="pointer-arrow" viewBox="${box.join(" ")}" aria-hidden="true" ` +
    `style="width:${px(box[2]!)};height:${px(box[3]!)};margin:${px(-pad)} 0 0 ${px(-pad)};` +
    `filter:drop-shadow(0 ${px(shadow.drop)} ${px(shadow.blur)} ${shadow.color})">` +
    `<polygon points="${points}" fill="${arrow.fill}" stroke="${arrow.stroke}" ` +
    `stroke-width="${strokeWidth}" stroke-linejoin="round"/></svg>`
  );
}
