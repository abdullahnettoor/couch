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

/** What is stored under `home.wallpaper`. */
export type WallpaperChoice = { kind: "builtin"; id: string } | { kind: "photo"; id: string };

/** A photo as stored under `home.photos`. */
export interface StoredPhoto {
  id: string;
  /** How much black goes over it, 0.35 to 0.65: brighter photos are dimmed more. */
  dim: number;
  addedAt: number;
}

/** A photo as the Screen draws it: where to load it from, and its dim. */
export interface PhotoTile {
  id: string;
  url: string;
  dim: number;
}

export const PHOTO_LIMIT = 6;

/** The most a photo may weigh after the phone has shrunk and encoded it. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** The same limit as base64 text: the longest `addPhoto` data the server passes on. */
export const MAX_PHOTO_DATA = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;

/** The dim for a photo of this average brightness (0 black to 1 white). */
export function dimFor(brightness: number): number {
  const b = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 1;
  return Math.round((0.35 + 0.3 * b) * 1000) / 1000;
}

/** A photo id is 12 hex characters; anything else never reaches a file path. */
export const PHOTO_ID = /^[0-9a-f]{12}$/;

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

/** A stored choice to a valid one: a photo only while it exists, anything else unknown becomes Couch. */
export function resolveChoice(value: unknown, photos: Array<{ id: string }>): WallpaperChoice {
  const v = value as Partial<WallpaperChoice> | null | undefined;
  if (v && v.kind === "photo" && typeof v.id === "string" && photos.some((p) => p.id === v.id))
    return { kind: "photo", id: v.id };
  return { kind: "builtin", id: resolveWallpaper(v).id };
}

/** The CSS variables a photo adds to `.home`: `--wp-photo` and `--wp-dim`. */
export function photoVars(photo: PhotoTile): Record<string, string> {
  return { "--wp-photo": `url("${photo.url}")`, "--wp-dim": String(photo.dim) };
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
