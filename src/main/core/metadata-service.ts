import type { Clock } from "../ports/clock.ts";
import {
  MetadataError,
  type Candidate,
  type EpisodeDetails,
  type Metadata,
  type MetadataKind,
  type SeasonDetails,
} from "../ports/metadata.ts";
import type { Store } from "../ports/store.ts";
import type { MediaLibrary } from "./media-library.ts";

const DAY_MS = 24 * 60 * 60_000;
const PARALLEL = 4;
const RATE_RETRIES = 3;
const RATE_WAIT_S = 2;
const MATCHES = 5;

export const KEY_HINT = "Add your own TMDB key for details";
const OWN_KEY_HINT = "Your TMDB key isn't working";

type KeySource = "own" | "project";

/** What is saved for one show or film. */
interface Entry {
  /** matched: details saved. none/failed: tried, retried after a day. frames: the household turned details off for this title. */
  state: "matched" | "none" | "failed" | "frames";
  triedAt: number;
  /** The household picked this match (or "frames"), so Refresh keeps it. */
  fixed?: boolean;
  tmdbId?: number;
  name?: string;
  year?: number;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  seasons?: SeasonDetails[];
}

interface Item {
  id: string;
  kind: MetadataKind;
  title: string;
  year?: number;
  seasons: number[];
}

/** Saved details with the cached images' URLs, ready to draw. */
export interface TitleDetails {
  tmdbId: number;
  name: string;
  year?: number;
  overview?: string;
  poster?: string;
  backdrop?: string;
  seasons: {
    number: number;
    episodes: (Omit<EpisodeDetails, "stillPath"> & { still?: string })[];
  }[];
}

export interface MatchOption {
  tmdbId: number;
  name: string;
  year?: number;
  poster?: string;
}

/** What the "Show and film details" Settings page shows. */
export interface DetailsSettings {
  /** "Built-in key", "Your key •••• last4" or "No key". */
  keyLabel: string;
  hasOwnKey: boolean;
  enabled: boolean;
  hint?: string;
}

interface Doc {
  items: Record<string, Entry>;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Show and film details from the Metadata port: one lookup per title, saved in the `metadata` Store
 * document, worked through by a small queue. Credentials are never logged, put in errors or exposed.
 */
export class MetadataService {
  #store: Store;
  #clock: Clock;
  #port: Metadata;
  #library: MediaLibrary;
  #projectKey: string;
  #changed: () => void;
  #items: Record<string, Entry>;
  #ownKey: string | undefined;
  #enabled: boolean;
  #queue: { item: Item; force: boolean }[] = [];
  #queued = new Set<string>();
  #running = 0;
  #idle: (() => void)[] = [];
  #problem: { source: KeySource; at: number } | undefined;
  #timers = new Set<() => void>();
  /** Bumped when the household chooses; lookups started before that are dropped. */
  #choices = new Map<string, number>();

  constructor(deps: {
    store: Store;
    clock: Clock;
    port: Metadata;
    library: MediaLibrary;
    projectKey?: string;
    changed: () => void;
  }) {
    this.#store = deps.store;
    this.#clock = deps.clock;
    this.#port = deps.port;
    this.#library = deps.library;
    this.#projectKey = deps.projectKey ?? "";
    this.#changed = deps.changed;
    const doc = deps.store.read<Partial<Doc>>("metadata", {});
    this.#items = doc.items && typeof doc.items === "object" ? doc.items : {};
    const settings = deps.store.read<{ key?: unknown; enabled?: unknown }>("tmdb", {});
    this.#ownKey = typeof settings.key === "string" && settings.key ? settings.key : undefined;
    this.#enabled = settings.enabled !== false;
  }

  /** The credential to use: the household's own, else the project's, else none. */
  #key(): { value: string; source: KeySource } | undefined {
    if (!this.#enabled) return undefined;
    if (this.#ownKey) return { value: this.#ownKey, source: "own" };
    if (this.#projectKey) return { value: this.#projectKey, source: "project" };
    return undefined;
  }

  #blocked(): boolean {
    const key = this.#key();
    const p = this.#problem;
    if (!key || !p) return false;
    if (p.source !== key.source || this.#clock.now() - p.at >= DAY_MS) {
      this.#problem = undefined;
      return false;
    }
    return true;
  }

  settings(): DetailsSettings {
    const hasOwnKey = this.#ownKey !== undefined;
    const keyLabel = hasOwnKey
      ? `Your key •••• ${this.#ownKey!.slice(-4)}`
      : this.#projectKey
        ? "Built-in key"
        : "No key";
    const hint = this.#blocked()
      ? this.#problem!.source === "project"
        ? KEY_HINT
        : OWN_KEY_HINT
      : undefined;
    return { keyLabel, hasOwnKey, enabled: this.#enabled, ...(hint ? { hint } : {}) };
  }

  /** True when a Settings hint should be shown without opening the page (a dead project key). */
  get hint(): string | undefined {
    return this.settings().hint;
  }

  setKey(key: string | undefined): void {
    const clean = key?.trim();
    this.#ownKey = clean || undefined;
    this.#saveSettings();
    this.#problem = undefined;
    this.sync();
    this.#changed();
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#saveSettings();
    if (enabled) this.sync();
    this.#changed();
  }

  #saveSettings(): void {
    this.#store.write("tmdb", {
      ...(this.#ownKey ? { key: this.#ownKey } : {}),
      enabled: this.#enabled,
    });
  }

  #libraryItems(): Item[] {
    return [
      ...this.#library.shows().map((s): Item => ({
        id: s.id,
        kind: "show",
        title: s.name,
        seasons: s.seasons.map((se) => se.number),
      })),
      ...this.#library.films().map((f): Item => ({
        id: f.id,
        kind: "film",
        title: f.year ? f.title.replace(/\s*\(\d{4}\)$/, "") : f.title,
        ...(f.year ? { year: f.year } : {}),
        seasons: [],
      })),
    ];
  }

  #item(id: string): Item | undefined {
    return this.#libraryItems().find((i) => i.id === id);
  }

  /** Looks up every show and film that has no saved result yet, or whose failed lookup is a day old. */
  sync(): void {
    if (!this.#key() || this.#blocked()) return;
    const now = this.#clock.now();
    for (const item of this.#libraryItems()) {
      const e = this.#items[item.id];
      if (!e || ((e.state === "none" || e.state === "failed") && now - e.triedAt >= DAY_MS))
        this.#enqueue(item, false);
    }
  }

  /** Fetches everything again. Matches chosen with Fix match are kept (and re-fetched). */
  refresh(): void {
    this.#problem = undefined;
    for (const item of this.#libraryItems()) {
      if (this.#items[item.id]?.state === "frames") continue;
      this.#enqueue(item, true);
    }
  }

  /** Resolves when the queue is empty and nothing is running. */
  settled(): Promise<void> {
    if (this.#running === 0 && this.#queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  dispose(): void {
    for (const cancel of this.#timers) cancel();
    this.#timers.clear();
  }

  #enqueue(item: Item, force: boolean): void {
    if (this.#queued.has(item.id)) return;
    this.#queued.add(item.id);
    this.#queue.push({ item, force });
    this.#pump();
  }

  #pump(): void {
    while (this.#running < PARALLEL && this.#queue.length > 0) {
      const next = this.#queue.shift()!;
      this.#running++;
      void this.#lookup(next.item, next.force)
        .catch(() => {})
        .finally(() => {
          this.#running--;
          this.#queued.delete(next.item.id);
          this.#pump();
          if (this.#running === 0 && this.#queue.length === 0) {
            for (const resolve of this.#idle.splice(0)) resolve();
          }
        });
    }
  }

  #sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const cancel = this.#clock.setTimeout(() => {
        this.#timers.delete(cancel);
        resolve();
      }, seconds * 1000);
      this.#timers.add(cancel);
    });
  }

  /** One call, retried on 429 a few times. */
  async #call<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (!(error instanceof MetadataError) || error.status !== 429 || attempt >= RATE_RETRIES)
          throw error;
        await this.#sleep(error.retryAfter ?? RATE_WAIT_S * 2 ** attempt);
      }
    }
  }

  #pick(item: Item, results: Candidate[]): Candidate | undefined {
    if (results.length === 0) return undefined;
    if (item.kind === "film") return results[0];
    const wanted = normalise(item.title);
    return (
      results.find((r) => normalise(r.name) === wanted) ??
      [...results].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0]
    );
  }

  async #lookup(item: Item, force: boolean): Promise<void> {
    const key = this.#key();
    if (!key || (this.#blocked() && !force)) return;
    const existing = this.#items[item.id];
    if (existing?.state === "frames") return;
    const stale = this.#staleCheck(item.id);
    try {
      let tmdbId = existing?.fixed ? existing.tmdbId : undefined;
      if (tmdbId === undefined) {
        const results = await this.#call(() =>
          this.#port.search(key.value, item.kind, item.title, item.year),
        );
        const hit = this.#pick(item, results);
        if (stale()) return;
        if (!hit) return this.#save(item.id, { state: "none", triedAt: this.#clock.now() });
        tmdbId = hit.id;
      }
      const id = tmdbId;
      const seasons = item.seasons.length
        ? item.seasons
        : (existing?.seasons ?? []).map((s) => s.number);
      const d = await this.#call(() => this.#port.details(key.value, item.kind, id, seasons));
      if (stale()) return;
      this.#save(item.id, {
        state: "matched",
        triedAt: this.#clock.now(),
        ...(existing?.fixed ? { fixed: true } : {}),
        tmdbId: d.id,
        name: d.name,
        year: d.year,
        overview: d.overview,
        posterPath: d.posterPath,
        backdropPath: d.backdropPath,
        seasons: d.seasons,
      });
      await this.#downloadImages(item.id);
    } catch (error) {
      if (stale()) return;
      if (
        error instanceof MetadataError &&
        (error.status === 401 || error.status === 403 || error.status === 429)
      ) {
        // The key itself is refused or exhausted: stop looking up and fall back to frames.
        this.#problem = { source: key.source, at: this.#clock.now() };
        this.#changed();
        return;
      }
      if (existing?.state === "matched") return;
      this.#save(item.id, { state: "failed", triedAt: this.#clock.now() });
    }
  }

  #staleCheck(id: string): () => boolean {
    const at = this.#choices.get(id) ?? 0;
    return () => (this.#choices.get(id) ?? 0) !== at;
  }

  #save(id: string, entry: Entry): void {
    this.#items[id] = entry;
    this.#store.write("metadata", { items: this.#items } satisfies Doc);
    this.#changed();
  }

  async #downloadImages(id: string): Promise<void> {
    const e = this.#items[id];
    if (!e) return;
    const jobs: (() => Promise<unknown>)[] = [];
    if (e.posterPath) jobs.push(() => this.#port.image("poster", e.posterPath!));
    if (e.backdropPath) jobs.push(() => this.#port.image("backdrop", e.backdropPath!));
    for (const s of e.seasons ?? [])
      for (const ep of s.episodes)
        if (ep.stillPath) jobs.push(() => this.#port.image("still", ep.stillPath!));
    for (const job of jobs) await job().catch(() => {});
    this.#changed();
  }

  /** The saved details for a show (by show id) or film (by its path); undefined means frames. */
  detailsFor(id: string): TitleDetails | undefined {
    const e = this.#items[id];
    if (e?.state !== "matched" || e.tmdbId === undefined) return undefined;
    const image = (kind: "poster" | "backdrop" | "still", path?: string) =>
      path ? this.#port.cachedImage(kind, path) : undefined;
    return {
      tmdbId: e.tmdbId,
      name: e.name ?? "",
      ...(e.year ? { year: e.year } : {}),
      ...(e.overview ? { overview: e.overview } : {}),
      poster: image("poster", e.posterPath),
      backdrop: image("backdrop", e.backdropPath),
      seasons: (e.seasons ?? []).map((s) => ({
        number: s.number,
        episodes: s.episodes.map(({ stillPath, ...rest }) => ({
          ...rest,
          still: image("still", stillPath),
        })),
      })),
    };
  }

  /** The household chose "Use video frames" for this title. */
  usesFrames(id: string): boolean {
    return this.#items[id]?.state === "frames";
  }

  /** The top 5 matches for Fix match, with their posters downloaded. Empty without a key or on failure. */
  async candidates(id: string): Promise<MatchOption[]> {
    const item = this.#item(id);
    const key = this.#key();
    if (!item || !key) return [];
    try {
      const results = (
        await this.#call(() => this.#port.search(key.value, item.kind, item.title, item.year))
      ).slice(0, MATCHES);
      return await Promise.all(
        results.map(async (r) => ({
          tmdbId: r.id,
          name: r.name,
          ...(r.year ? { year: r.year } : {}),
          ...(r.posterPath ? { poster: await this.#port.image("poster", r.posterPath) } : {}),
        })),
      );
    } catch {
      return [];
    }
  }

  /** Re-links a title to a chosen TMDB result, or to "frames" (details off for it). Saved; Refresh keeps it. */
  async fixMatch(id: string, choice: number | "frames"): Promise<void> {
    this.#choices.set(id, (this.#choices.get(id) ?? 0) + 1);
    const stale = this.#staleCheck(id);
    if (choice === "frames") {
      this.#save(id, { state: "frames", triedAt: this.#clock.now(), fixed: true });
      return;
    }
    const item = this.#item(id);
    const key = this.#key();
    if (!item || !key) return;
    const previous = this.#items[id];
    this.#items[id] = { state: "failed", triedAt: this.#clock.now(), fixed: true, tmdbId: choice };
    try {
      const d = await this.#call(() =>
        this.#port.details(key.value, item.kind, choice, item.seasons),
      );
      if (stale()) return;
      this.#save(id, {
        state: "matched",
        triedAt: this.#clock.now(),
        fixed: true,
        tmdbId: d.id,
        name: d.name,
        year: d.year,
        overview: d.overview,
        posterPath: d.posterPath,
        backdropPath: d.backdropPath,
        seasons: d.seasons,
      });
      await this.#downloadImages(id);
    } catch {
      if (stale()) return;
      if (previous) this.#items[id] = previous;
      else delete this.#items[id];
    }
  }
}
