import type { PlaybackReport } from "../apps/app.ts";
import type { Store } from "../ports/store.ts";
import { titleKey } from "../web/resume-url.ts";
import type { ContinueArt } from "./continue-art.ts";

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
  /** Key of the picture Couch saved from the App's own host (`continue-art/<key>.jpg`); never the App's address. */
  art?: string;
  /** The address that reopens the title, built by the App's description (the title id and the time only). */
  url: string;
  /** Couch's own last position and the duration, in seconds. */
  position: number;
  duration: number;
  /** Epoch ms of the last update. */
  at: number;
}

export { titleKey };

/** The App's own id for the title, from its canonical resume URL (Netflix `/watch/<id>`, YouTube `v=<id>`). */
export const titleId = (url: string): string | undefined =>
  /^https:\/\/[^/]+\/watch\/(\d+)/.exec(url)?.[1] ?? /[?&]v=([\w-]{11})(?:&|$)/.exec(url)?.[1];

/** The address that opens the title at its start (for an App whose resume URL carries the time). */
export const fromStartUrl = titleKey;

/** App titles left unfinished, newest first, kept in the Store (`continue-apps`). */
export class ContinueApps {
  #store: Store;
  #items: AppContinue[];
  #dirty = false;
  #wroteAt = 0;
  #art: ContinueArt | undefined;
  #hostsFor: (app: string) => string[];
  #changed: () => void;
  /** The picture each title's latest report named (by App and title), while it may still be downloading. */
  #wanted = new Map<string, string>();

  /**
   * `art` keeps each title's picture on disk: it is downloaded once when an entry is remembered or
   * its picture changes, and deleted with the entry. `hostsFor` names an App's own artwork hosts.
   */
  constructor(
    store: Store,
    options: {
      art?: ContinueArt;
      hostsFor?: (app: string) => string[];
      changed?: () => void;
    } = {},
  ) {
    this.#store = store;
    this.#art = options.art;
    this.#hostsFor = options.hostsFor ?? (() => []);
    this.#changed = options.changed ?? (() => {});
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
          ...(typeof e.art === "string" && /^[0-9a-f]{40}$/.test(e.art) ? { art: e.art } : {}),
        },
      ];
    });
    this.#art?.sweep(new Set(this.#items.flatMap((i) => i.art ?? [])));
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
    if (playback.ad || !url || !(playback.duration > 0)) return;
    const key = titleKey(url);
    const index = this.#items.findIndex((e) => e.app === app && titleKey(e.url) === key);
    const finished =
      playback.ended === true || playback.position / playback.duration >= FINISHED_FRACTION;
    if (finished) {
      if (index >= 0) this.#drop(index);
      else return;
      return this.#write(now);
    }
    if (index < 0 && playback.position < MIN_REMEMBER_SECONDS) return;
    const before = this.#items[index];
    let art = before?.art;
    if (playback.artwork && this.#art) {
      const pic = this.#art.keyFor(playback.artwork);
      this.#wanted.set(`${app}\0${key}`, pic);
      if (this.#art.has(pic)) art = pic;
      else this.#download(app, pic, playback.artwork);
    }
    const entry: AppContinue = {
      app,
      title: playback.title ?? before?.title ?? "",
      url,
      position: playback.position,
      duration: playback.duration,
      at: now,
      ...(art ? { art } : {}),
    };
    if (!entry.title) return;
    const isNew = index < 0;
    if (isNew) this.#items.push(entry);
    else this.#items[index] = entry;
    if (before?.art && before.art !== art) this.#release(before.art);
    const kept = this.entries();
    for (const gone of kept.slice(MAX_APP_ENTRIES)) {
      this.#wanted.delete(`${gone.app}\0${titleKey(gone.url)}`);
      if (gone.art) this.#release(gone.art, gone);
    }
    this.#items = kept.slice(0, MAX_APP_ENTRIES);
    this.#dirty = true;
    if (isNew || now - this.#wroteAt >= WRITE_EVERY_MS) this.#write(now);
  }

  /** Drops one entry (by App and title key); true if there was one. */
  forget(app: string, key: string): boolean {
    const index = this.#items.findIndex((e) => e.app === app && titleKey(e.url) === key);
    if (index < 0) return false;
    this.#drop(index);
    this.#write(this.#wroteAt);
    return true;
  }

  /** Writes what is pending. */
  flush(): void {
    if (this.#dirty) this.#write(this.#wroteAt);
  }

  #drop(index: number): void {
    const [gone] = this.#items.splice(index, 1);
    if (gone) this.#wanted.delete(`${gone.app}\0${titleKey(gone.url)}`);
    if (gone?.art) this.#release(gone.art);
  }

  /** Deletes a picture's file unless another entry still shows it. */
  #release(key: string, except?: AppContinue): void {
    if (this.#items.some((e) => e !== except && e.art === key)) return;
    this.#art?.remove(key);
  }

  /** Fetches a title's picture in the background; the entry takes it when it arrives. */
  #download(app: string, key: string, url: string): void {
    void this.#art!.get(url, this.#hostsFor(app)).then((got) => {
      if (!got) return;
      const wanted = this.#items.filter((e) => e.app === app && this.#pendingFor(e, key));
      if (!wanted.length) return this.#release(got);
      for (const e of wanted) {
        const old = e.art;
        e.art = got;
        if (old && old !== got) this.#release(old);
      }
      this.#write(this.#wroteAt);
      this.#changed();
    });
  }

  /** Whether the entry's latest report named this picture (it may have moved on to another while it downloaded). */
  #pendingFor(entry: AppContinue, key: string): boolean {
    return this.#wanted.get(`${entry.app}\0${titleKey(entry.url)}`) === key;
  }

  #write(now: number): void {
    this.#dirty = false;
    this.#wroteAt = now;
    this.#store.write("continue-apps", { items: this.#items });
  }
}
