import type { PlaybackReport } from "../apps/app.ts";
import type { Store } from "../ports/store.ts";

/** An App title plays this long before Couch remembers it. */
export const MIN_REMEMBER_SECONDS = 30;
/** At or past this share of the duration (or when the App says it ended) the title is finished and forgotten. */
export const FINISHED_FRACTION = 0.95;
export const MAX_APP_ENTRIES = 10;
/** The position is written to the Store at most this often while a title plays. */
const WRITE_EVERY_MS = 5000;

/** What is kept for a title: nothing but these (never cookies, tokens or account data). */
export interface AppContinue {
  /** The App's id. */
  app: string;
  title: string;
  /** Artwork on one of the App's own hosts, as its host vetted it. */
  art?: string;
  /** The address that reopens the title, built by the App's description (the title id and the time only). */
  url: string;
  /** Couch's own last position and the duration, in seconds. */
  position: number;
  duration: number;
  /** Epoch ms of the last update. */
  at: number;
}

/** The title's identity: its resume URL without the time, so one title is one entry however far it has played. */
export const titleKey = (url: string): string =>
  url
    .replace(/([?&#])t=\d+&?/, "$1")
    .replace(/[?&]$/, "")
    .replace(/&$/, "");

/** The address that opens the title at its start (for an App whose resume URL carries the time). */
export const fromStartUrl = titleKey;

/** App titles left unfinished, newest first, kept in the Store (`continue-apps`). */
export class ContinueApps {
  #store: Store;
  #items: AppContinue[];
  #dirty = false;
  #wroteAt = 0;

  constructor(store: Store) {
    this.#store = store;
    const saved = store.read<{ items?: unknown }>("continue-apps", {});
    this.#items = (Array.isArray(saved.items) ? saved.items : []).flatMap((i) => {
      const e = i as Partial<AppContinue> | null;
      if (
        !e ||
        typeof e.app !== "string" ||
        typeof e.title !== "string" ||
        typeof e.url !== "string" ||
        !Number.isFinite(e.position) ||
        !(Number(e.duration) > 0) ||
        !Number.isFinite(e.at)
      )
        return [];
      return [
        {
          app: e.app,
          title: e.title,
          url: e.url,
          position: e.position!,
          duration: e.duration!,
          at: e.at!,
          ...(typeof e.art === "string" ? { art: e.art } : {}),
        },
      ];
    });
  }

  entries(): AppContinue[] {
    return [...this.#items].sort((a, b) => b.at - a.at);
  }

  find(app: string, key: string): AppContinue | undefined {
    return this.#items.find((e) => e.app === app && titleKey(e.url) === key);
  }

  /** What an App's page reports it is playing; `undefined` (nothing playing) saves what is pending. */
  report(app: string, playback: PlaybackReport | undefined, now: number): void {
    if (!playback) return this.flush();
    const url = playback.resume;
    if (!url || !(playback.duration > 0)) return;
    const key = titleKey(url);
    const index = this.#items.findIndex((e) => e.app === app && titleKey(e.url) === key);
    const finished =
      playback.ended === true || playback.position / playback.duration >= FINISHED_FRACTION;
    if (finished) {
      if (index >= 0) this.#items.splice(index, 1);
      else return;
      return this.#write(now);
    }
    if (index < 0 && playback.position < MIN_REMEMBER_SECONDS) return;
    const entry: AppContinue = {
      app,
      title: playback.title ?? this.#items[index]?.title ?? "",
      url,
      position: playback.position,
      duration: playback.duration,
      at: now,
      ...((playback.artwork ?? this.#items[index]?.art)
        ? { art: playback.artwork ?? this.#items[index]!.art }
        : {}),
    };
    if (!entry.title) return;
    const isNew = index < 0;
    if (isNew) this.#items.push(entry);
    else this.#items[index] = entry;
    this.#items = this.entries().slice(0, MAX_APP_ENTRIES);
    this.#dirty = true;
    if (isNew || now - this.#wroteAt >= WRITE_EVERY_MS) this.#write(now);
  }

  /** Drops one entry (by App and title key); true if there was one. */
  forget(app: string, key: string): boolean {
    const index = this.#items.findIndex((e) => e.app === app && titleKey(e.url) === key);
    if (index < 0) return false;
    this.#items.splice(index, 1);
    this.#write(this.#wroteAt);
    return true;
  }

  /** Writes what is pending. */
  flush(): void {
    if (this.#dirty) this.#write(this.#wroteAt);
  }

  #write(now: number): void {
    this.#dirty = false;
    this.#wroteAt = now;
    this.#store.write("continue-apps", { items: this.#items });
  }
}
