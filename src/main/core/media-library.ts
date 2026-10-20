import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Clock } from "../ports/clock.ts";
import type { Store } from "../ports/store.ts";
import {
  groupVideos,
  type Episode,
  type Film,
  type Grouped,
  type IndexedVideo,
  type Show,
} from "./grouping.ts";
import { parseTitle, VIDEO_EXTENSIONS } from "./library.ts";

export type { Episode, Extra, Film, IndexedVideo, Season, Show } from "./grouping.ts";

const MAX_DEPTH = 12;
const SKIP_FILE = /sample|trailer/i;

/** What Next up needs from watch history. */
export interface WatchState {
  isWatched(path: string): boolean;
  progress(path: string): { position: number; duration: number } | undefined;
  touchedAt(path: string): number | undefined;
}

export interface NextUp {
  show: Show;
  episode: Episode;
}

export interface RecentlyAdded {
  kind: "show" | "film";
  show?: Show;
  film?: Film;
  addedAt: number;
}

interface IndexDoc {
  videos: IndexedVideo[];
}

type Found = { path: string; size: number; mtime: number; folders: string[] };

/** Every video under `root`, asynchronously (the event loop is free between reads). Undefined if the folder can't be read. */
async function scanRoot(root: string): Promise<Found[] | undefined> {
  const out: Found[] = [];
  const walk = async (dir: string, folders: string[], depth: number): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      // "." covers macOS AppleDouble "._*" files on external drives, which look like videos but aren't.
      if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
      const full = join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const s = await stat(full);
          isDir = s.isDirectory();
          isFile = s.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (depth < MAX_DEPTH) await walk(full, [...folders, e.name], depth + 1);
      } else if (
        isFile &&
        VIDEO_EXTENSIONS.includes(extname(e.name).toLowerCase()) &&
        !SKIP_FILE.test(e.name)
      ) {
        try {
          const s = await stat(full);
          out.push({ path: full, size: s.size, mtime: Math.round(s.mtimeMs), folders });
        } catch {
          // vanished between listing and stat
        }
      }
    }
    return true;
  };
  return (await walk(root, [], 0)) ? out : undefined;
}

/**
 * The Library's index: every video under the Library folders, saved in the `index` Store document,
 * grouped into Shows and Films. Reads are instant (from the saved index); `refresh` rescans in the background.
 */
export class MediaLibrary {
  #store: Store;
  #clock: Pick<Clock, "now">;
  #videos: IndexedVideo[];
  #grouped: Grouped | undefined;
  #running: Promise<void> | undefined;
  #again: string[] | undefined;
  #listeners = new Set<() => void>();

  constructor(store: Store, clock: Pick<Clock, "now">) {
    this.#store = store;
    this.#clock = clock;
    const saved = store.read<Partial<IndexDoc>>("index", {});
    this.#videos = Array.isArray(saved.videos) ? saved.videos : [];
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** Rescan the Library folders in the background and update the saved index. Overlapping calls are merged. */
  refresh(roots: string[]): Promise<void> {
    if (this.#running) {
      this.#again = roots;
      return this.#running;
    }
    const run = (async () => {
      let next: string[] | undefined = roots;
      while (next) {
        this.#again = undefined;
        await this.#scan(next).catch(() => {});
        next = this.#again;
      }
    })().finally(() => {
      this.#running = undefined;
    });
    this.#running = run;
    return run;
  }

  /** Resolves when no scan is running. */
  settled(): Promise<void> {
    return this.#running ?? Promise.resolve();
  }

  async #scan(roots: string[]): Promise<void> {
    const now = this.#clock.now();
    const first = this.#videos.length === 0;
    const known = new Map(this.#videos.map((v) => [v.path, v]));
    const next: IndexedVideo[] = [];
    for (const root of roots) {
      const found = await scanRoot(root);
      if (!found) {
        // The drive isn't there: keep what we knew, dimmed.
        for (const v of this.#videos) if (v.root === root) next.push({ ...v, missing: true });
        continue;
      }
      for (const f of found) {
        const old = known.get(f.path);
        const title = parseTitle(basename(f.path));
        next.push({
          path: f.path,
          size: f.size,
          mtime: f.mtime,
          root,
          folders: f.folders,
          title,
          // The first scan of an existing library would make everything "new", so it uses file dates.
          firstSeen: old?.firstSeen ?? (first ? Math.min(f.mtime, now) : now),
        });
      }
    }
    next.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (JSON.stringify(next) === JSON.stringify(this.#videos)) return;
    this.#videos = next;
    this.#grouped = undefined;
    this.#store.write("index", { videos: next } satisfies IndexDoc);
    for (const l of [...this.#listeners]) l();
  }

  #group(): Grouped {
    return (this.#grouped ??= groupVideos(this.#videos));
  }

  /** Shows A–Z. */
  shows(): Show[] {
    return this.#group().shows;
  }

  /** Films A–Z. */
  films(): Film[] {
    return this.#group().films;
  }

  /** A show with its seasons, episodes in order and Extras. */
  show(id: string): Show | undefined {
    return this.#group().shows.find((s) => s.id === id);
  }

  /** The show an episode belongs to, by the episode's path. */
  showOf(path: string): Show | undefined {
    return this.#group().shows.find((s) =>
      s.seasons.some((se) => se.episodes.some((e) => e.path === path)),
    );
  }

  /** The episode after this one in its show's order (across seasons), or undefined for the last or a non-episode. */
  nextEpisode(path: string): Episode | undefined {
    const show = this.showOf(path);
    if (!show) return undefined;
    const all = show.seasons.flatMap((s) => s.episodes);
    const at = all.findIndex((e) => e.path === path);
    const cur = all[at]!;
    return all.slice(at + 1).find((e) => e.season !== cur.season || e.episode !== cur.episode);
  }

  /**
   * For each started show, the episode after the furthest watched one, most recently watched show first.
   * A show with nothing watched yet but one in progress offers that episode; a finished show offers nothing.
   */
  nextUp(history: WatchState): NextUp[] {
    const out: { item: NextUp; at: number }[] = [];
    for (const show of this.shows()) {
      const all = show.seasons.flatMap((s) => s.episodes);
      const touched = all.map((e) => history.touchedAt(e.path) ?? 0);
      const at = Math.max(0, ...touched);
      if (at === 0) continue;
      const furthest = all.findLastIndex((e) => history.isWatched(e.path));
      const episode =
        furthest === -1
          ? all.find((e) => history.progress(e.path))
          : all.slice(furthest + 1).find((e) => !history.isWatched(e.path));
      if (episode) out.push({ item: { show, episode }, at });
    }
    return out.sort((a, b) => b.at - a.at).map((o) => o.item);
  }

  /** Newest first-seen shows and films, up to `max`. */
  recentlyAdded(max = 20): RecentlyAdded[] {
    const g = this.#group();
    return [
      ...g.shows.map((show): RecentlyAdded => ({ kind: "show", show, addedAt: show.addedAt })),
      ...g.films.map((film): RecentlyAdded => ({ kind: "film", film, addedAt: film.addedAt })),
    ]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, max);
  }
}
