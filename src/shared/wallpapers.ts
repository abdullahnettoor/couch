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

/** What is stored under `home.wallpaper`. A `file` is a file name inside its folder, never a path. */
export type WallpaperChoice =
  | { kind: "builtin"; id: string }
  | { kind: "mac" }
  | { kind: "folder"; file: string }
  | { kind: "apple"; file: string };

export type PictureKind = "mac" | "folder" | "apple";

/** How often Home moves to the next folder picture. */
export type Slideshow = "off" | "hour" | "day";

export const SLIDESHOW_MS: Record<Exclude<Slideshow, "off">, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/** The most folder pictures Settings shows. */
export const FOLDER_LIMIT = 48;

/** A picture from the Mac as the Screen draws it. `url` and `thumb` are there once it is converted. */
export interface PictureTile {
  kind: PictureKind;
  /** The file name inside its folder (folder and apple pictures). */
  file?: string;
  label: string;
  /** The TV-size copy, a Couch-only `file:` URL. */
  url?: string;
  thumb?: string;
  /** How much black goes over it, 0.35 to 0.65: brighter pictures are dimmed more. */
  dim?: number;
}

/** The dim for a picture of this average brightness (0 black to 1 white). */
export function dimFor(brightness: number): number {
  const b = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 1;
  return Math.round((0.35 + 0.3 * b) * 1000) / 1000;
}

/** A picture's average brightness (0 to 1) recovered from its dim: `dimFor` backwards. */
export function lightFor(dim: number): number {
  const b = Math.min(1, Math.max(0, (dim - 0.35) / 0.3));
  return Math.round(b * 1000) / 1000;
}

/** A converted copy's key is 12 hex characters; anything else never reaches a file path. */
export const CACHE_KEY = /^[0-9a-f]{12}$/;

export const DEFAULT_WALLPAPER: WallpaperChoice = { kind: "builtin", id: "couch" };

/** Any stored value to a built-in wallpaper; unknown or malformed becomes Couch. */
export function resolveWallpaper(value: unknown): Wallpaper {
  const v = value as Partial<WallpaperChoice> | null | undefined;
  const found =
    v && v.kind === "builtin" && typeof v.id === "string"
      ? WALLPAPERS.find((w) => w.id === v.id)
      : undefined;
  return found ?? WALLPAPERS[0]!;
}

/** A stored value to a well-formed choice (whether the picture still exists is for Couch to check); anything else is Couch. */
export function parseChoice(value: unknown): WallpaperChoice {
  const v = value as Record<string, unknown> | null | undefined;
  if (v && v.kind === "mac") return { kind: "mac" };
  if (v && (v.kind === "folder" || v.kind === "apple") && isFileName(v.file))
    return { kind: v.kind, file: v.file };
  return { kind: "builtin", id: resolveWallpaper(v).id };
}

/** A name inside a folder: non-empty, no separators, not `.` or `..`. */
export function isFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value !== "." &&
    value !== ".."
  );
}

/** A file name as a tile label: no extension, no size tokens or trailing ids, separators as spaces. */
export function tidyName(file: string): string {
  const base = file.replace(/\.[^./]+$/, "");
  const words = base
    .replace(/[_-]+/g, " ")
    .replace(/\b\d{3,5}x\d{3,5}\b/gi, " ")
    .replace(/\s+\d{4,}\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = words || base.trim() || file;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The CSS variables a picture adds to `.home`: `--wp-photo`, `--wp-dim` and its brightness `--wp-light` (0 to 1). */
export function photoVars(tile: { url: string; dim: number }): Record<string, string> {
  return {
    "--wp-photo": `url("${tile.url}")`,
    "--wp-dim": String(tile.dim),
    "--wp-light": String(lightFor(tile.dim)),
  };
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
