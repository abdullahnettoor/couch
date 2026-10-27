import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PHOTO_ID } from "../../shared/wallpapers.ts";

/** A phone's photo decoded and re-encoded: EXIF (location included) is gone. */
export interface EncodedPhoto {
  jpeg: Buffer;
  /** Average brightness, 0 black to 1 white. */
  brightness: number;
}

/** The Photos port: Home wallpaper photos, kept as `wallpapers/<id>.jpg` in the app data folder. */
export interface Photos {
  /** Decodes the bytes and re-encodes them as JPEG; undefined when they don't decode as a picture. */
  encode(bytes: Buffer): EncodedPhoto | undefined;
  save(id: string, jpeg: Buffer): void;
  remove(id: string): void;
  /** The Couch-only `file:` URL the Screen loads the photo from. */
  url(id: string): string;
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Buffer) => b.length > PNG.length && PNG.every((v, i) => b[i] === v);

/** The bytes start like a JPEG or a PNG (the only kinds Couch accepts). */
export function looksLikeImage(bytes: Buffer): boolean {
  return isJpeg(bytes) || isPng(bytes);
}

/** The most a photo may declare, per side and in all, before Couch decodes it (a small file can declare a huge picture). */
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

/** Files in `<userData>/wallpapers`; ids that aren't 12 hex characters are refused, so nothing leaves the folder. */
export class PhotoFiles {
  #dir: string;
  constructor(dir: string) {
    this.#dir = dir;
  }
  #file(id: string): string {
    if (!PHOTO_ID.test(id)) throw new Error("bad photo id");
    return join(this.#dir, `${id}.jpg`);
  }
  save(id: string, jpeg: Buffer): void {
    const file = this.#file(id);
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(`${file}.tmp`, jpeg);
    renameSync(`${file}.tmp`, file);
  }
  remove(id: string): void {
    rmSync(this.#file(id), { force: true });
  }
  url(id: string): string {
    return pathToFileURL(this.#file(id)).href;
  }
}
