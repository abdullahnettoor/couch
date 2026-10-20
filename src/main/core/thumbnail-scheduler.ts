import { nullThumbnails, type Thumbnails } from "../ports/thumbnails.ts";

const JOBS = 2;

/**
 * The one place pictures are requested from: cached ones appear at once, the rest are made in
 * the background a couple at a time. `want` is a view's whole list (it replaces what was waiting);
 * `lookup` asks for a single picture as the UI draws it.
 */
export class ThumbnailScheduler {
  #thumbs: Thumbnails;
  #onReady: () => void;
  #urls = new Map<string, string>();
  #queue: string[] = [];
  #busy = new Set<string>();
  #failed = new Set<string>();
  #running = 0;
  #disposed = false;

  constructor(thumbs: Thumbnails | undefined, onReady: () => void) {
    this.#thumbs = thumbs ?? nullThumbnails;
    this.#onReady = onReady;
  }

  /** The picture's URL if it exists already (made now or cached on disk). Never starts work. */
  urlFor(path: string): string | undefined {
    const known = this.#urls.get(path);
    if (known) return known;
    const cached = this.#thumbs.cached(path);
    if (cached) this.#urls.set(path, cached);
    return cached;
  }

  /** A view needs these pictures: they replace whatever was waiting. */
  want(paths: string[]): void {
    this.#queue = [];
    for (const path of new Set(paths)) {
      this.#failed.delete(path);
      if (this.#busy.has(path) || this.urlFor(path)) continue;
      this.#queue.push(path);
    }
    this.#pump();
  }

  /** One picture as it is drawn: its URL now, or undefined while it is made (a failed one is not retried). */
  lookup(path: string): string | undefined {
    const url = this.urlFor(path);
    if (url || this.#busy.has(path) || this.#failed.has(path) || this.#queue.includes(path)) {
      return url;
    }
    this.#queue.push(path);
    this.#pump();
    return undefined;
  }

  dispose(): void {
    this.#disposed = true;
  }

  #pump(): void {
    while (!this.#disposed && this.#running < JOBS && this.#queue.length) {
      const path = this.#queue.shift()!;
      this.#running++;
      this.#busy.add(path);
      void this.#thumbs
        .make(path)
        .catch(() => undefined)
        .then((url) => {
          this.#running--;
          this.#busy.delete(path);
          if (url) this.#urls.set(path, url);
          else this.#failed.add(path);
          if (url && !this.#disposed) this.#onReady();
          this.#pump();
        });
    }
  }
}
