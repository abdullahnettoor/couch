import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CACHE_KEY } from "../../shared/wallpapers.ts";

/** A file or folder inside a directory the Mac lists, as the OS reports it (the core decides what counts). */
export interface MacEntry {
  name: string;
  /** Where it is, for the converter to read. */
  path: string;
  kind: "file" | "dir" | "symlink" | "other";
  size: number;
  mtimeMs: number;
}

/** The Mac as a source of wallpapers. Read-only: nothing here writes, moves or deletes. */
export interface MacWallpapers {
  /** `~/Pictures/Wallpapers`. */
  defaultFolder(): string;
  /** What is directly inside a folder (no recursion); undefined when it can't be read. */
  listFolder(path: string): MacEntry[] | undefined;
  /** The main display's current desktop picture, resolved to an image file when it can be; undefined when none. */
  desktopPicture(): MacEntry | undefined;
  /** What is directly inside `/System/Library/Desktop Pictures`. */
  appleWallpapers(): MacEntry[];
  /** The Mac's own folder chooser; undefined when cancelled. */
  chooseFolder(current: string): Promise<string | undefined>;
}

/** A source picture decoded and re-encoded: EXIF (location included) is gone. */
export interface ConvertedPicture {
  /** At most 3840 × 2160, JPEG. */
  jpeg: Buffer;
  /** A small JPEG for the Settings tile. */
  thumb: Buffer;
  /** Average brightness, 0 black to 1 white. */
  brightness: number;
}

/** Checks a source picture (magic bytes, declared size) and converts it with the 107 pipeline; undefined when it fails any check. */
export interface WallpaperConverter {
  convert(path: string): Promise<ConvertedPicture | undefined>;
}

/** Converted copies in `<userData>/wallpapers`, by key. */
export interface WallpaperFiles {
  /** Both files of a key are there. */
  has(key: string): boolean;
  save(key: string, jpeg: Buffer, thumb: Buffer): void;
  remove(key: string): void;
  /** Every key that has a file. */
  keys(): string[];
  /** The Couch-only `file:` URLs the Screen loads. */
  url(key: string): string;
  thumbUrl(key: string): string;
}

/** What Couch needs from the Mac to offer its wallpapers. */
export interface WallpaperPorts {
  mac: MacWallpapers;
  converter: WallpaperConverter;
  files: WallpaperFiles;
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Buffer) => b.length > PNG.length && PNG.every((v, i) => b[i] === v);
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
const isHeic = (b: Buffer) =>
  b.length >= 12 &&
  b.toString("latin1", 4, 8) === "ftyp" &&
  HEIC_BRANDS.includes(b.toString("latin1", 8, 12));

/** What the bytes start like: the only kinds Couch accepts are JPEG, PNG and HEIC. */
export function pictureKind(bytes: Buffer): "jpeg" | "png" | "heic" | undefined {
  if (isJpeg(bytes)) return "jpeg";
  if (isPng(bytes)) return "png";
  if (isHeic(bytes)) return "heic";
  return undefined;
}

/** The longest side of a converted picture's box: 3840 × 2160. */
export const TV_WIDTH = 3840;
export const TV_HEIGHT = 2160;
export const THUMB_WIDTH = 320;

/** The size to scale `width × height` to so it fits the TV box (never larger than the source). */
export function fitWithin(
  width: number,
  height: number,
  maxW = TV_WIDTH,
  maxH = TV_HEIGHT,
): { width: number; height: number } {
  const k = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The most a picture may declare, per side and in all, before Couch decodes it (a small file can declare a huge picture). */
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 40_000_000;

/** The size a JPEG (its SOF segment) or PNG (its IHDR) declares, read from the header bytes alone. */
export function imageSize(b: Buffer): { width: number; height: number } | undefined {
  if (isPng(b)) {
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return undefined;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (!isJpeg(b)) return undefined;
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return undefined;
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = b.readUInt16BE(at + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (at + 9 > b.length) return undefined;
      return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) };
    }
    if (length < 2) return undefined;
    at += 2 + length;
  }
  return undefined;
}

/** Mean brightness 0..1 of a BGRA or RGBA bitmap (Rec. 709 weights on the gamma-encoded values). */
export function meanBrightness(bitmap: Uint8Array, bgra: boolean): number {
  const pixels = Math.floor(bitmap.length / 4);
  if (pixels === 0) return 1;
  let sum = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const r = bitmap[bgra ? o + 2 : o]!;
    const g = bitmap[o + 1]!;
    const b = bitmap[bgra ? o : o + 2]!;
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return sum / pixels / 255;
}

/** Files in `<userData>/wallpapers`: `<key>.jpg` and `<key>.thumb.jpg`. Keys that aren't 12 hex characters are refused, so nothing leaves the folder. */
export class WallpaperFilesOnDisk implements WallpaperFiles {
  #dir: string;
  constructor(dir: string) {
    this.#dir = dir;
  }
  #file(key: string, thumb = false): string {
    if (!CACHE_KEY.test(key)) throw new Error("bad wallpaper key");
    return join(this.#dir, thumb ? `${key}.thumb.jpg` : `${key}.jpg`);
  }
  has(key: string): boolean {
    this.#file(key);
    try {
      const names = new Set(readdirSync(this.#dir));
      return names.has(`${key}.jpg`) && names.has(`${key}.thumb.jpg`);
    } catch {
      return false;
    }
  }
  save(key: string, jpeg: Buffer, thumb: Buffer): void {
    mkdirSync(this.#dir, { recursive: true });
    for (const [file, bytes] of [
      [this.#file(key, true), thumb],
      [this.#file(key), jpeg],
    ] as const) {
      writeFileSync(`${file}.tmp`, bytes);
      renameSync(`${file}.tmp`, file);
    }
  }
  remove(key: string): void {
    rmSync(this.#file(key), { force: true });
    rmSync(this.#file(key, true), { force: true });
  }
  keys(): string[] {
    try {
      const found = new Set<string>();
      for (const name of readdirSync(this.#dir)) {
        const m = /^([0-9a-f]{12})(\.thumb)?\.jpg$/.exec(name);
        if (m) found.add(m[1]!);
      }
      return [...found];
    } catch {
      return [];
    }
  }
  url(key: string): string {
    return pathToFileURL(this.#file(key)).href;
  }
  thumbUrl(key: string): string {
    return pathToFileURL(this.#file(key, true)).href;
  }
}
