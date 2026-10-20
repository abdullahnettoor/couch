import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

/** The Thumbnails port: a picture for a video file, made once and cached. */
export interface Thumbnails {
  /** The picture's URL if one is already cached for the file's current version. Never runs ffmpeg. */
  cached(path: string): string | undefined;
  /** Makes (or finds) the picture. Resolves undefined when the file can't be read. */
  make(path: string): Promise<string | undefined>;
}

export const nullThumbnails: Thumbnails = {
  cached: () => undefined,
  make: () => Promise.resolve(undefined),
};

/** Cache key: changes when the path, size or modified time changes. */
export function thumbnailKey(path: string, size: number, mtimeMs: number): string {
  return createHash("sha1")
    .update(`${path}\0${size}\0${Math.round(mtimeMs)}`)
    .digest("hex");
}

export function findFfmpeg(
  env: { PATH?: string } = process.env,
  isExecutable: (p: string) => boolean = (p) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
): string | undefined {
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", ...(env.PATH ?? "").split(delimiter)];
  for (const dir of dirs.filter(Boolean)) {
    const candidate = join(dir, "ffmpeg");
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 30_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
      // `ffmpeg -i file` with no output exits non-zero but still prints the duration.
      err && !stderr
        ? reject(err)
        : err && !/Duration:/.test(stderr)
          ? reject(err)
          : resolve(stdout + stderr),
    );
  });
}

function parseDuration(text: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return undefined;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return s > 0 ? s : undefined;
}

/** One 480px-wide JPEG per video at ~10% of its duration, cached in a folder. */
export class FfmpegThumbnails implements Thumbnails {
  #ffmpeg: string | undefined;
  #dir: string;
  #failed = new Set<string>();
  constructor(dir: string, ffmpeg: string | undefined = findFfmpeg()) {
    this.#dir = dir;
    this.#ffmpeg = ffmpeg;
  }
  #file(path: string): { key: string; file: string } | undefined {
    try {
      const st = statSync(path);
      const key = thumbnailKey(path, st.size, st.mtimeMs);
      return { key, file: join(this.#dir, `${key}.jpg`) };
    } catch {
      return undefined;
    }
  }
  cached(path: string): string | undefined {
    const f = this.#file(path);
    return f && existsSync(f.file) ? pathToFileURL(f.file).href : undefined;
  }
  async make(path: string): Promise<string | undefined> {
    const f = this.#file(path);
    if (!f || !this.#ffmpeg) return undefined;
    if (existsSync(f.file)) return pathToFileURL(f.file).href;
    if (this.#failed.has(f.key)) return undefined;
    try {
      mkdirSync(this.#dir, { recursive: true });
      const duration = parseDuration(await run(this.#ffmpeg, ["-hide_banner", "-i", path]));
      const tmp = `${f.file}.tmp.jpg`;
      await run(this.#ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(duration ? duration * 0.1 : 0),
        "-i",
        path,
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2",
        "-q:v",
        "4",
        tmp,
      ]);
      renameSync(tmp, f.file);
      return pathToFileURL(f.file).href;
    } catch {
      this.#failed.add(f.key);
      return undefined;
    }
  }
}
