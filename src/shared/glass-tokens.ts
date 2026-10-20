/**
 * Glass design tokens: one source for the Screen renderer, the Remote page and the YouTube HUD.
 * Each surface injects them as CSS custom properties; lengths scale by that surface's own unit
 * (the Screen's `--u`, the phone's `1px`, the YouTube page's `--couch-u`).
 */
const COLORS = {
  t1: "#fff",
  t2: "rgba(235, 235, 245, 0.74)",
  t3: "rgba(235, 235, 245, 0.52)",
  glass: "rgba(44, 44, 48, 0.46)",
  "glass-strong": "rgba(36, 36, 40, 0.72)",
  "glass-edge": "inset 0 1px 0 rgba(255, 255, 255, 0.14)",
  card: "#2c2c2e",
  "card-2": "#48484a",
  live: "#30d158",
  danger: "#ff453a",
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

/** Radii in design pixels (a 1920-wide Screen). */
const RADII = { "r-tile": 22, "r-row": 22 } as const;

export interface GlassTokenOptions {
  selector?: string;
  /** What one design pixel is, e.g. "var(--u)" or "1px". */
  unit: string;
  /** Prepended to every property name after the dashes, to avoid clashing with a host page. */
  prefix?: string;
}

export function glassTokensCss({
  selector = ":root",
  unit,
  prefix = "",
}: GlassTokenOptions): string {
  const lines = [
    ...Object.entries(COLORS).map(([name, value]) => `--${prefix}${name}: ${value};`),
    ...Object.entries(RADII).map(([name, px]) => `--${prefix}${name}: calc(${px} * ${unit});`),
  ];
  return `${selector} { ${lines.join(" ")} }`;
}
