/** The built-in Home wallpapers: CSS gradients only. */

export interface Wallpaper {
  id: string;
  label: string;
  /** Hex colours of the base radial gradient: centre-left glow, middle, edge. */
  core: string;
  mid: string;
  edge: string;
  /** The two drifting glows as [r, g, b, alpha]. */
  glow: [[number, number, number, number], [number, number, number, number]];
  /** Seconds for one drift. */
  drift: number;
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: "couch",
    label: "Couch",
    core: "#2a2a2f",
    mid: "#0b0b0d",
    edge: "#000000",
    glow: [
      [120, 130, 170, 0.16],
      [150, 110, 150, 0.1],
    ],
    drift: 90,
  },
  {
    id: "dusk",
    label: "Dusk",
    core: "#2a2147",
    mid: "#0d0a1c",
    edge: "#030208",
    glow: [
      [110, 90, 190, 0.14],
      [150, 90, 170, 0.08],
    ],
    drift: 120,
  },
  {
    id: "ocean",
    label: "Ocean",
    core: "#123237",
    mid: "#061218",
    edge: "#010406",
    glow: [
      [60, 150, 160, 0.13],
      [50, 90, 160, 0.09],
    ],
    drift: 120,
  },
  {
    id: "forest",
    label: "Forest",
    core: "#17301f",
    mid: "#08130c",
    edge: "#020503",
    glow: [
      [80, 150, 100, 0.12],
      [120, 140, 70, 0.07],
    ],
    drift: 120,
  },
  {
    id: "ember",
    label: "Ember",
    core: "#3a1a12",
    mid: "#130908",
    edge: "#040202",
    glow: [
      [200, 90, 50, 0.12],
      [190, 130, 50, 0.07],
    ],
    drift: 120,
  },
  {
    id: "graphite",
    label: "Graphite",
    core: "#252527",
    mid: "#0b0b0c",
    edge: "#010101",
    glow: [
      [150, 150, 160, 0.07],
      [120, 120, 130, 0.05],
    ],
    drift: 120,
  },
];

/** What is stored under `home.wallpaper`; a `photo` kind can join the union later. */
export type WallpaperChoice = { kind: "builtin"; id: string };

export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "builtin", id: "couch" };

/** Any stored value to a wallpaper; unknown or malformed becomes Couch. */
export function resolveWallpaper(value: unknown): Wallpaper {
  const v = value as Partial<WallpaperChoice> | null | undefined;
  const found =
    v && v.kind === "builtin" && typeof v.id === "string"
      ? WALLPAPERS.find((w) => w.id === v.id)
      : undefined;
  return found ?? WALLPAPERS[0]!;
}

/** The CSS variables `.home` reads: `--wp-base`, `--wp-glow` and `--wp-drift`. */
export function wallpaperVars(id: string): Record<string, string> {
  const w = resolveWallpaper({ kind: "builtin", id });
  const [a, b] = w.glow;
  const rgba = ([r, g, bl, al]: Wallpaper["glow"][number]) => `rgba(${r}, ${g}, ${bl}, ${al})`;
  return {
    "--wp-base": `radial-gradient(70% 90% at 22% 18%, ${w.core} 0%, ${w.mid} 60%, ${w.edge} 100%)`,
    "--wp-glow": `radial-gradient(40% 50% at 30% 30%, ${rgba(a)}, transparent 70%), radial-gradient(35% 45% at 70% 70%, ${rgba(b)}, transparent 70%)`,
    "--wp-drift": `${w.drift}s`,
  };
}
