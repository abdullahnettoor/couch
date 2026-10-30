import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ownArtwork } from "../web/playback.ts";

export const MAX_ART_BYTES = 2 * 1024 * 1024;
const MAX_HOPS = 3;
const KEY = /^[0-9a-f]{40}$/;

/** `fetch` as the main process has it, on a session that holds no cookies. */
export type ArtFetch = (
  url: string,
  init: { credentials: "omit"; redirect: "manual"; signal?: AbortSignal },
) => Promise<Response>;

/** The real picture formats a title's art comes in, by their first bytes (never SVG or HTML). */
function isImage(b: Uint8Array): boolean {
  const at = (i: number, s: string) => s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b[0] === 0x89 && at(1, "PNG")) ||
    at(0, "GIF8") ||
    (at(0, "RIFF") && at(8, "WEBP")) ||
    at(4, "ftypavif")
  );
}

async function readCapped(res: Response): Promise<Uint8Array | undefined> {
  const reader = res.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ART_BYTES) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * Downloads a picture from an App's own artwork host: https and the host checked at every hop
 * (a redirect is followed at most a few times and only to another own address), no cookies, an
 * image type, at most about 2 MB. Undefined for anything else.
 */
export async function downloadArt(
  url: string,
  hosts: string[],
  fetchFn: ArtFetch,
): Promise<Uint8Array | undefined> {
  const own = (u: string) => {
    try {
      return new URL(u).username === "" && new URL(u).password === "" && ownArtwork(u, hosts);
    } catch {
      return false;
    }
  };
  try {
    let at = url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!own(at)) return undefined;
      const res = await fetchFn(at, {
        credentials: "omit",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) return undefined;
        at = new URL(next, at).href;
        continue;
      }
      if (res.status !== 200) return undefined;
      if (!/^image\/(jpeg|png|webp|gif|avif)\b/i.test(res.headers.get("content-type") ?? ""))
        return undefined;
      if (Number(res.headers.get("content-length") ?? 0) > MAX_ART_BYTES) return undefined;
      const bytes = await readCapped(res);
      return bytes && isImage(bytes) ? bytes : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * The art Continue watching shows for App titles, kept on disk (`continue-art/<hash>.jpg`). The
 * main process downloads each picture once; entries hold only the hash, never the App's address
 * (which can carry tokens).
 */
export class ContinueArt {
  #dir: string;
  #fetch: ArtFetch | undefined;
  #pending = new Map<string, Promise<string | undefined>>();
  #failed = new Set<string>();

  constructor(dir: string, fetchFn?: ArtFetch) {
    this.#dir = dir;
    this.#fetch = fetchFn;
  }

  get dir(): string {
    return this.#dir;
  }

  /** The name a picture is kept under: a hash of its address. */
  keyFor(url: string): string {
    return createHash("sha1").update(url).digest("hex");
  }

  #file(key: string): string | undefined {
    return KEY.test(key) ? join(this.#dir, `${key}.jpg`) : undefined;
  }

  has(key: string): boolean {
    const file = this.#file(key);
    return !!file && existsSync(file);
  }

  /** The Screen's address for a kept picture, if the file is there. */
  fileUrl(key: string): string | undefined {
    const file = this.#file(key);
    return file && existsSync(file) ? pathToFileURL(file).href : undefined;
  }

  /** The key of the picture at `url`, downloading it first when it is not kept yet. */
  get(url: string, hosts: string[]): Promise<string | undefined> {
    const key = this.keyFor(url);
    if (this.has(key)) return Promise.resolve(key);
    if (!this.#fetch || this.#failed.has(key)) return Promise.resolve(undefined);
    const running = this.#pending.get(key);
    if (running) return running;
    const job = (async () => {
      const bytes = await downloadArt(url, hosts, this.#fetch!);
      const file = this.#file(key)!;
      if (!bytes) {
        this.#failed.add(key);
        return undefined;
      }
      try {
        mkdirSync(this.#dir, { recursive: true });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, bytes);
        renameSync(tmp, file);
        return key;
      } catch {
        this.#failed.add(key);
        return undefined;
      }
    })().finally(() => this.#pending.delete(key));
    this.#pending.set(key, job);
    return job;
  }

  remove(key: string): void {
    const file = this.#file(key);
    if (file) rmSync(file, { force: true });
  }

  /** Deletes every picture whose key is not in `keep`. */
  sweep(keep: Set<string>): void {
    let names: string[];
    try {
      names = readdirSync(this.#dir);
    } catch {
      return;
    }
    for (const name of names) {
      const m = /^([0-9a-f]{40})\.jpg(?:\.tmp)?$/.exec(name);
      if (m && !keep.has(m[1]!)) rmSync(join(this.#dir, name), { force: true });
    }
  }
}
