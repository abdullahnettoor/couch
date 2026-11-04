/**
 * Look: every visual fact of Couch's style in one typed object. Glass is the only Look today.
 * Each surface (the Screen, the phone, Quick settings, a Web App's controls) injects it as CSS custom
 * properties with `lookCss`; TypeScript that needs the same numbers imports them from here.
 *
 * Lengths are in design pixels (a 1920-wide Screen) and scale by the surface's own unit
 * (the Screen's `--u`, the phone's `1px`, a Web App page's `--couch-u`). Strings that carry lengths
 * write them as `{u}`, e.g. `calc(24 * {u})`.
 */
export interface Look {
  /** Role colours, then `palette`: every other colour literal in use, named by its value (to be given roles later). */
  color: {
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    glass: string;
    glassStrong: string;
    glassSolid: string;
    card: string;
    card2: string;
    live: string;
    danger: string;
    scrim: string;
    buttonFill: string;
    palette: Record<string, string>;
  };
  type: {
    family: string;
    familyDisplay: string;
    /** Font sizes by design pixel. */
    size: Record<string, number>;
    weight: Record<string, string>;
    lineHeight: Record<string, string>;
    letterSpacing: Record<string, string>;
  };
  /** Corner radii by role, then `scale`: every radius in use, by design pixel. */
  radius: { tile: number; row: number; scale: Record<string, number> };
  shadow: Record<string, string>;
  blur: Record<string, string>;
  motion: { ease: Record<string, string>; duration: Record<string, string> };
  focus: { bg: string; fg: string; scale: number; scaleTile: number; lift: number; ring: string };
  metrics: {
    base: { width: number; height: number };
    row: { height: number; padX: number; font: number; gap: number; valueFont: number };
    library: {
      tileColumns: number;
      scrollMarginBlock: number;
      scrollMarginEdge: number;
      scrollMarginSearch: number;
    };
  };
}

const sizes = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 30, 32, 34, 36, 38, 40, 44,
  48, 52, 56, 60, 64, 72, 76, 88, 92, 116, 132, 200, 280,
];
const radii = [
  1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 30, 32, 36, 40, 42, 44, 46, 48,
  60, 62, 64, 120,
];
const byPx = (list: number[], key = (n: number) => `s${n}`) =>
  Object.fromEntries(list.map((n) => [key(n), n]));

export const GLASS: Look = {
  color: {
    textPrimary: "#fff",
    textSecondary: "rgba(235, 235, 245, 0.74)",
    textTertiary: "rgba(235, 235, 245, 0.52)",
    glass: "rgba(44, 44, 48, 0.46)",
    glassStrong: "rgba(36, 36, 40, 0.72)",
    glassSolid: "rgba(30, 30, 34, 0.92)",
    card: "#2c2c2e",
    card2: "#48484a",
    live: "#30d158",
    danger: "#ff453a",
    scrim: "rgba(0, 0, 0, 0.45)",
    buttonFill: "rgba(255, 255, 255, 0.16)",
    palette: {
      "hex-000": "#000",
      "hex-050404": "#050404",
      "hex-0a84ff": "#0a84ff",
      "hex-0b0b0c": "#0b0b0c",
      "hex-0c0907": "#0c0907",
      "hex-161412": "#161412",
      "hex-17171a": "#17171a",
      "hex-1b130c": "#1b130c",
      "hex-1c1206": "#1c1206",
      "hex-1c1c1e": "#1c1c1e",
      "hex-222": "#222",
      "hex-241405": "#241405",
      "hex-2a2a2d": "#2a2a2d",
      "hex-2c2c2e": "#2c2c2e",
      "hex-30d158": "#30d158",
      "hex-3a3a3c": "#3a3a3c",
      "hex-3a3a3e": "#3a3a3e",
      "hex-5a5a5c": "#5a5a5c",
      "hex-8e8e93": "#8e8e93",
      "hex-c4141f": "#c4141f",
      "hex-c9c9cf": "#c9c9cf",
      "hex-e5e5e5": "#e5e5e5",
      "hex-e5e5ea": "#e5e5ea",
      "hex-f4efe6": "#f4efe6",
      "hex-f5f5f7": "#f5f5f7",
      "hex-ff3b30": "#ff3b30",
      "hex-ffb04a": "#ffb04a",
      "hex-ffd08a": "#ffd08a",
      "hex-fff": "#fff",
      "rgb-0-0-0-a012": "rgba(0, 0, 0, 0.12)",
      "rgb-0-0-0-a02": "rgba(0, 0, 0, 0.2)",
      "rgb-0-0-0-a025": "rgba(0, 0, 0, 0.25)",
      "rgb-0-0-0-a03": "rgba(0, 0, 0, 0.3)",
      "rgb-0-0-0-a035": "rgba(0, 0, 0, 0.35)",
      "rgb-0-0-0-a04": "rgba(0, 0, 0, 0.4)",
      "rgb-0-0-0-a045": "rgba(0, 0, 0, 0.45)",
      "rgb-0-0-0-a05": "rgba(0, 0, 0, 0.5)",
      "rgb-0-0-0-a055": "rgba(0, 0, 0, 0.55)",
      "rgb-0-0-0-a06": "rgba(0, 0, 0, 0.6)",
      "rgb-0-0-0-a062": "rgba(0, 0, 0, 0.62)",
      "rgb-0-0-0-a07": "rgba(0, 0, 0, 0.7)",
      "rgb-0-0-0-a072": "rgba(0, 0, 0, 0.72)",
      "rgb-0-0-0-a085": "rgba(0, 0, 0, 0.85)",
      "rgb-0-0-0-a086": "rgba(0, 0, 0, 0.86)",
      "rgb-0-0-0-a088": "rgba(0, 0, 0, 0.88)",
      "rgb-0-0-0-a09": "rgba(0, 0, 0, 0.9)",
      "rgb-14-14-18-a062": "rgba(14, 14, 18, 0.62)",
      "rgb-20-20-24-a01": "rgba(20, 20, 24, 0.1)",
      "rgb-255-255-255-a0": "rgba(255, 255, 255, 0)",
      "rgb-255-255-255-a006": "rgba(255, 255, 255, 0.06)",
      "rgb-255-255-255-a007": "rgba(255, 255, 255, 0.07)",
      "rgb-255-255-255-a008": "rgba(255, 255, 255, 0.08)",
      "rgb-255-255-255-a01": "rgba(255, 255, 255, 0.1)",
      "rgb-255-255-255-a012": "rgba(255, 255, 255, 0.12)",
      "rgb-255-255-255-a014": "rgba(255, 255, 255, 0.14)",
      "rgb-255-255-255-a016": "rgba(255, 255, 255, 0.16)",
      "rgb-255-255-255-a018": "rgba(255, 255, 255, 0.18)",
      "rgb-255-255-255-a02": "rgba(255, 255, 255, 0.2)",
      "rgb-255-255-255-a022": "rgba(255, 255, 255, 0.22)",
      "rgb-255-255-255-a025": "rgba(255, 255, 255, 0.25)",
      "rgb-255-255-255-a03": "rgba(255, 255, 255, 0.3)",
      "rgb-255-255-255-a032": "rgba(255, 255, 255, 0.32)",
      "rgb-255-255-255-a034": "rgba(255, 255, 255, 0.34)",
      "rgb-255-255-255-a045": "rgba(255, 255, 255, 0.45)",
      "rgb-255-255-255-a05": "rgba(255, 255, 255, 0.5)",
      "rgb-255-255-255-a08": "rgba(255, 255, 255, 0.8)",
      "rgb-255-255-255-a085": "rgba(255, 255, 255, 0.85)",
      "rgb-28-28-30-a075": "rgba(28, 28, 30, 0.75)",
      "rgb-30-30-32-a06": "rgba(30, 30, 32, 0.6)",
      "rgb-30-30-32-a07": "rgba(30, 30, 32, 0.7)",
      "rgb-40-40-44-a092": "rgba(40, 40, 44, 0.92)",
    },
  },
  type: {
    family: '-apple-system, "SF Pro Text", system-ui, sans-serif',
    familyDisplay: '-apple-system, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
    size: byPx(sizes),
    weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
    lineHeight: {},
    letterSpacing: {},
  },
  radius: { tile: 22, row: 22, scale: byPx(radii, (n) => `r${n}`) },
  shadow: {
    "glass-edge": "inset 0 1px 0 rgba(255, 255, 255, 0.14)",
    card: "0 calc(24 * {u}) calc(70 * {u}) rgba(0, 0, 0, 0.35)",
    "card-deep": "0 calc(24 * {u}) calc(60 * {u}) rgba(0, 0, 0, 0.45)",
    float: "0 calc(36 * {u}) calc(60 * {u}) rgba(0, 0, 0, 0.6)",
    "focus-ring-soft": "0 0 0 calc(3 * {u}) rgba(255, 255, 255, 0.5)",
  },
  blur: {
    "glass-light": "blur(calc(20 * {u})) saturate(1.6)",
    "glass-heavy": "blur(calc(40 * {u})) saturate(1.8)",
    glass: "blur(calc(30 * {u})) saturate(1.6)",
  },
  motion: {
    ease: {
      glass: "cubic-bezier(0.16, 1, 0.3, 1)",
      back: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
      settle: "cubic-bezier(0.33, 1, 0.68, 1)",
      standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    },
    duration: { quick: "0.2s", base: "0.3s", slow: "0.45s" },
  },
  focus: {
    bg: "#fff",
    fg: "#000",
    scale: 1.06,
    scaleTile: 1.09,
    lift: 6,
    ring: "0 0 0 calc(5 * {u}) #fff",
  },
  metrics: {
    base: { width: 1920, height: 1080 },
    row: { height: 96, padX: 32, font: 32, gap: 8, valueFont: 26 },
    library: {
      tileColumns: 4,
      scrollMarginBlock: 60,
      scrollMarginEdge: 96,
      scrollMarginSearch: 120,
    },
  },
};

export interface LookCssOptions {
  selector?: string;
  /** What one design pixel is, e.g. "var(--u)" or "1px". */
  unit: string;
  /** Prepended to every property name after the dashes, to avoid clashing with a host page. */
  prefix?: string;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The CSS custom properties for a Look, as one rule. Old token names stay as aliases until the rules move over. */
export function lookCss(
  look: Look,
  { selector = ":root", unit, prefix = "" }: LookCssOptions,
): string {
  const len = (n: number) => `calc(${n} * ${unit})`;
  const sub = (s: string) => s.replaceAll("{u}", unit);
  const out: [string, string][] = [];
  const add = (name: string, value: string) => out.push([name, value]);

  const { color, type, radius, shadow, blur, motion, focus, metrics } = look;
  const { palette, ...roles } = color;
  for (const [k, v] of Object.entries(roles)) add(kebab(k), v);
  for (const [k, v] of Object.entries(palette)) add(k, v);

  add("font-family", type.family);
  add("font-family-display", type.familyDisplay);
  for (const [k, n] of Object.entries(type.size)) add(`type-${k}`, len(n));
  for (const [k, v] of Object.entries(type.weight)) add(`weight-${k}`, v);
  for (const [k, v] of Object.entries(type.lineHeight)) add(`line-height-${k}`, v);
  for (const [k, v] of Object.entries(type.letterSpacing)) add(`letter-spacing-${k}`, v);

  add("radius-tile", len(radius.tile));
  add("radius-row", len(radius.row));
  for (const [k, n] of Object.entries(radius.scale)) add(`radius-${k}`, len(n));
  for (const [k, v] of Object.entries(shadow)) add(`shadow-${k}`, sub(v));
  for (const [k, v] of Object.entries(blur)) add(`blur-${k}`, sub(v));
  for (const [k, v] of Object.entries(motion.ease)) add(`ease-${k}`, v);
  for (const [k, v] of Object.entries(motion.duration)) add(`duration-${k}`, v);

  add("focus-bg", focus.bg);
  add("focus-fg", focus.fg);
  add("focus-scale", String(focus.scale));
  add("focus-scale-tile", String(focus.scaleTile));
  add("focus-lift", len(focus.lift));
  add("focus-ring", sub(focus.ring));

  add("design-width", String(metrics.base.width));
  add("design-height", String(metrics.base.height));
  add("row-height", len(metrics.row.height));
  add("row-pad-x", len(metrics.row.padX));
  add("row-font", len(metrics.row.font));
  add("row-gap", len(metrics.row.gap));
  add("row-value-font", len(metrics.row.valueFont));
  add("lib-cols", String(metrics.library.tileColumns));
  add("scroll-margin-block", len(metrics.library.scrollMarginBlock));
  add("scroll-margin-edge", len(metrics.library.scrollMarginEdge));
  add("scroll-margin-search", len(metrics.library.scrollMarginSearch));

  // Old names, kept until every rule has moved to the role names above (glass, glass-strong, glass-solid, card, live and danger are the same in both).
  add("t1", color.textPrimary);
  add("t2", color.textSecondary);
  add("t3", color.textTertiary);
  add("glass-edge", sub(shadow["glass-edge"]!));
  add("card-2", color.card2);
  add("ease", motion.ease.glass!);
  add("r-tile", len(radius.tile));
  add("r-row", len(radius.row));

  return `${selector} { ${out.map(([n, v]) => `--${prefix}${n}: ${v};`).join(" ")} }`;
}
