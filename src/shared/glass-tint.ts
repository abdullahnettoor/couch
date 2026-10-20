/** Fallback glass: a dark version of the video's main colour, used when native glass is unavailable. */
export type Rgb = readonly [number, number, number];

const DARKEN = 0.28;
const ALPHA = 0.82;
const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

export function darkTint([r, g, b]: Rgb): string {
  return `rgba(${clamp(clamp(r) * DARKEN)}, ${clamp(clamp(g) * DARKEN)}, ${clamp(clamp(b) * DARKEN)}, ${ALPHA})`;
}
