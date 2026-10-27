import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  exifOrientation,
  fitWithin,
  imageSize,
  MAX_PIXELS,
  MAX_SIDE,
  meanBrightness,
  orientationFlags,
  pictureKind,
  readBmp,
  stripMetadata,
  THUMB_WIDTH,
  TV_HEIGHT,
  TV_WIDTH,
  type ConvertedPicture,
  type WallpaperConverter,
} from "./pictures.ts";

const SAMPLE = 32;
const SIPS = "/usr/bin/sips";
/** A source bigger than this is refused before it is read. */
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

export type Run = (file: string, args: string[]) => Promise<string>;

const run: Run = (file, args) =>
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
 * The 107 pipeline for pictures that already sit on the Mac. The source is opened once (never through a
 * symlink), checked to be the regular file that was listed, and read from that handle; those bytes are
 * checked (magic bytes, declared size) and copied into a private folder of ours, where `sips` does all
 * the decoding, turning upright, resizing and encoding in child processes, so Couch's own process never
 * decodes a picture and never waits on one. The JPEG that comes out has its metadata segments removed.
 * Nothing is ever written to the source's folder, and `sips` never sees the source's path.
 */
export class ElectronConverter implements WallpaperConverter {
  #work: string;
  #run: Run;
  constructor(workDir: string, runner: Run = run) {
    this.#work = workDir;
    this.#run = runner;
  }

  async convert(
    path: string,
    expect?: { size: number; dev?: number; ino?: number },
  ): Promise<ConvertedPicture | undefined> {
    let tmp: string | undefined;
    try {
      const bytes = await this.#read(path, expect);
      if (!bytes) return undefined;
      const kind = pictureKind(bytes);
      if (!kind) return undefined;
      if (kind !== "heic" && !withinLimits(imageSize(bytes))) return undefined;
      await mkdir(this.#work, { recursive: true });
      tmp = await mkdtemp(join(this.#work, ".convert-"));
      const input = join(tmp, `in.${kind}`);
      await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
      if (kind === "heic" && !withinLimits(await this.#size(input))) return undefined;

      const upright = join(tmp, "upright.jpg");
      await this.#run(SIPS, [
        ...(kind === "jpeg" ? orientationFlags(exifOrientation(bytes)) : []),
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "90",
        input,
        "--out",
        upright,
      ]);
      const size = await this.#size(upright);
      if (!size) return undefined;
      const tv = fitWithin(size.width, size.height, TV_WIDTH, TV_HEIGHT);
      let full = upright;
      if (tv.width !== size.width || tv.height !== size.height) {
        full = join(tmp, "full.jpg");
        await this.#resize(upright, full, tv, 85);
      }
      const small = fitWithin(tv.width, tv.height, THUMB_WIDTH, THUMB_WIDTH);
      const thumb = join(tmp, "thumb.jpg");
      await this.#resize(full, thumb, small, 75);
      const sample = join(tmp, "sample.bmp");
      await this.#run(SIPS, [
        "-z",
        String(SAMPLE),
        String(SAMPLE),
        "-s",
        "format",
        "bmp",
        full,
        "--out",
        sample,
      ]);
      const bmp = readBmp(await readFile(sample));
      if (!bmp) return undefined;
      return {
        jpeg: stripMetadata(await readFile(full)),
        thumb: stripMetadata(await readFile(thumb)),
        brightness: meanBrightness(bmp.bgra, true),
      };
    } catch {
      return undefined;
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Opens without following a symlink, checks the handle is the listed regular file, and reads that handle. */
  async #read(
    path: string,
    expect?: { size: number; dev?: number; ino?: number },
  ): Promise<Buffer | undefined> {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > MAX_SOURCE_BYTES) return undefined;
      if (expect) {
        if (st.size !== expect.size) return undefined;
        if (expect.dev !== undefined && st.dev !== expect.dev) return undefined;
        if (expect.ino !== undefined && st.ino !== expect.ino) return undefined;
      }
      const bytes = await handle.readFile();
      return bytes.length === st.size ? bytes : undefined;
    } finally {
      await handle.close();
    }
  }

  async #size(path: string): Promise<{ width: number; height: number } | undefined> {
    const out = await this.#run(SIPS, ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const width = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
    return width && height ? { width, height } : undefined;
  }

  async #resize(
    from: string,
    to: string,
    size: { width: number; height: number },
    quality: number,
  ): Promise<void> {
    await this.#run(SIPS, [
      "-z",
      String(size.height),
      String(size.width),
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      String(quality),
      from,
      "--out",
      to,
    ]);
  }
}
