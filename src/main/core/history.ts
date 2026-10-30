import { existsSync } from "node:fs";
import type { Store } from "../ports/store.ts";

export const MIN_RECORD_SECONDS = 60;
export const WATCHED_FRACTION = 0.9;
export const WATCHED_REMAINING_SECONDS = 120;

interface WatchEntry {
  /** Resume position; absent once watched. */
  position?: number;
  duration: number;
  watched?: boolean;
  /** Epoch ms of the last save. */
  at: number;
}

export interface InProgress {
  path: string;
  position: number;
  duration: number;
  at: number;
}

/** Where each Library video was left, per absolute file path, persisted in the Store. */
export class History {
  #store: Store;
  #items: Record<string, WatchEntry>;

  constructor(store: Store) {
    this.#store = store;
    const saved = store.read<{ items?: Record<string, WatchEntry> }>("history", {});
    this.#items = saved.items && typeof saved.items === "object" ? saved.items : {};
  }

  /** Where to resume, or undefined to play from the start. */
  resumeAt(path: string): number | undefined {
    return this.#items[path]?.position;
  }

  isWatched(path: string): boolean {
    return this.#items[path]?.watched === true;
  }

  /** Epoch ms of the last save for this video, or undefined if it has no record. */
  touchedAt(path: string): number | undefined {
    return this.#items[path]?.at;
  }

  progress(path: string): { position: number; duration: number } | undefined {
    const r = this.#items[path];
    return r?.position === undefined ? undefined : { position: r.position, duration: r.duration };
  }

  /** Record where playback is. `ended` is a natural end of file. */
  save(path: string, position: number, duration: number, now: number, ended = false): void {
    if (ended) {
      this.#items[path] = { duration, watched: true, at: now };
    } else {
      if (!(duration > 0)) return;
      const watched =
        position / duration >= WATCHED_FRACTION || duration - position <= WATCHED_REMAINING_SECONDS;
      if (watched) this.#items[path] = { duration, watched: true, at: now };
      else if (position >= MIN_RECORD_SECONDS) this.#items[path] = { position, duration, at: now };
      else return;
    }
    this.#store.write("history", { items: this.#items });
  }

  /** Drops where this video was left; true if it had a record. */
  forget(path: string): boolean {
    if (!(path in this.#items)) return false;
    delete this.#items[path];
    this.#store.write("history", { items: this.#items });
    return true;
  }

  /** In-progress videos whose files still exist, newest first. */
  continueWatching(): InProgress[] {
    return Object.entries(this.#items)
      .filter(([path, r]) => r.position !== undefined && existsSync(path))
      .map(([path, r]) => ({ path, position: r.position!, duration: r.duration, at: r.at }))
      .sort((a, b) => b.at - a.at);
  }
}
