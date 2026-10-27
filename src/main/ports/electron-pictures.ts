import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { nativeImage } from "electron";
import {
  fitWithin,
  imageSize,
  MAX_PIXELS,
  MAX_SIDE,
  meanBrightness,
  pictureKind,
  THUMB_WIDTH,
  TV_HEIGHT,
  TV_WIDTH,
  type ConvertedPicture,
  type WallpaperConverter,
} from "./pictures.ts";

const SAMPLE = 32;
/** A source bigger than this is refused before it is read. */
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(file, args, { timeout: 60_000, maxBuffer: 1 << 20 }, (err, out) =>
      err ? reject(err) : resolve(out),
    ),
  );

const withinLimits = (size: { width: number; height: number } | undefined) =>
  !!size &&
  size.width >= 1 &&
  size.height >= 1 &&
  size.width <= MAX_SIDE &&
  size.height <= MAX_SIDE &&
  size.width * size.height <= MAX_PIXELS;

/**
 * The 107 pipeline for pictures that already sit on the Mac: magic bytes, declared size, decode in the
 * main process, re-encode as JPEG (EXIF gone), a TV-size copy, a small thumbnail and the brightness.
 * HEIC goes through `sips`, which reads the source and writes only into `workDir` (our own folder).
 * Nothing is ever written to the source's folder.
 */
export class ElectronConverter implements WallpaperConverter {
  #work: string;
  constructor(workDir: string) {
    this.#work = workDir;
  }

  async convert(path: string): Promise<ConvertedPicture | undefined> {
    try {
      const st = statSync(path);
      if (!st.isFile() || st.size > MAX_SOURCE_BYTES) return undefined;
      const bytes = readFileSync(path);
      const kind = pictureKind(bytes);
      if (!kind) return undefined;
      if (kind !== "heic") return this.#decode(bytes);
      const size = await this.#sipsSize(path);
      if (!withinLimits(size)) return undefined;
      return this.#decode(await this.#sipsJpeg(path));
    } catch {
      return undefined;
    }
  }

  async #sipsSize(path: string): Promise<{ width: number; height: number } | undefined> {
    const out = await run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const width = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
    return width && height ? { width, height } : undefined;
  }

  /** A JPEG of at most 3840 on its longest side, written to our own folder and read back. */
  async #sipsJpeg(path: string): Promise<Buffer> {
    mkdirSync(this.#work, { recursive: true });
    const out = join(this.#work, `.convert-${randomBytes(6).toString("hex")}.jpg`);
    try {
      await run("/usr/bin/sips", [
        "-s",
        "format",
        "jpeg",
        "-Z",
        String(TV_WIDTH),
        path,
        "--out",
        out,
      ]);
      return readFileSync(out);
    } finally {
      rmSync(out, { force: true });
    }
  }

  #decode(bytes: Buffer): ConvertedPicture | undefined {
    // The declared size is read from the header first: decoding is where a small file turns into gigabytes.
    if (!withinLimits(imageSize(bytes))) return undefined;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return undefined;
    const { width, height } = image.getSize();
    const tv = fitWithin(width, height, TV_WIDTH, TV_HEIGHT);
    const full = tv.width < width ? image.resize({ ...tv, quality: "best" }) : image;
    const thumb = fitWithin(width, height, THUMB_WIDTH, THUMB_WIDTH);
    const small = image.resize({ width: SAMPLE, height: SAMPLE, quality: "good" });
    return {
      jpeg: full.toJPEG(85),
      thumb: image.resize({ ...thumb, quality: "good" }).toJPEG(75),
      brightness: meanBrightness(small.toBitmap(), true),
    };
  }
}
