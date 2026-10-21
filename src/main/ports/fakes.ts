import type { Thumbnails } from "./thumbnails.ts";
import type {
  Candidate,
  Details,
  ImageKind,
  Metadata,
  MetadataError,
  MetadataKind,
} from "./metadata.ts";
import type { LoadOptions, Player, PlayerEvent } from "../../shared/player.ts";
import type { Clock } from "./clock.ts";
import type { DisplayInfo, Mac } from "./mac.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "./youtube.ts";

function emitter<E>() {
  const listeners = new Set<(event: E) => void>();
  return {
    on(listener: (event: E) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(event: E) {
      for (const l of [...listeners]) l(event);
    },
  };
}

export class FakePlayer implements Player {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  #events = emitter<PlayerEvent>();
  position: number | undefined;

  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
    return Promise.resolve();
  }
  load(path: string, options?: LoadOptions) {
    return this.#record("load", path, options);
  }
  setPaused(paused: boolean) {
    return this.#record("setPaused", paused);
  }
  seekBy(seconds: number) {
    return this.#record("seekBy", seconds);
  }
  seekTo(seconds: number) {
    return this.#record("seekTo", seconds);
  }
  setSubtitles(visible: boolean) {
    return this.#record("setSubtitles", visible);
  }
  setSubtitlesRaised(raised: boolean, aboveUpNext = false) {
    void this.#record("setSubtitlesRaised", raised, aboveUpNext);
  }
  getPosition() {
    return Promise.resolve(this.position);
  }
  stop() {
    return this.#record("stop");
  }
  /** Set to make `setDisplay` reject, like mpv refusing to move. */
  displayFails = false;
  setDisplay(name: string | undefined) {
    this.#record("setDisplay", name);
    return this.displayFails ? Promise.reject(new Error("cannot move")) : Promise.resolve();
  }
  onEvent(listener: (event: PlayerEvent) => void) {
    return this.#events.on(listener);
  }
  dispose() {
    return this.#record("dispose");
  }
  emit(event: PlayerEvent) {
    this.#events.emit(event);
  }
}

export class FakeYouTube implements YouTube {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  #events = emitter<YouTubeEvent>();
  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
  }
  show(note?: string) {
    this.#record("show", note);
  }
  hide() {
    this.#record("hide");
  }
  sendKey(key: YouTubeKey) {
    this.#record("sendKey", key);
  }
  openSearch() {
    this.#record("openSearch");
  }
  setSearchText(text: string) {
    this.#record("setSearchText", text);
  }
  submitSearch() {
    this.#record("submitSearch");
  }
  playPause() {
    this.#record("playPause");
  }
  seekBy(seconds: number) {
    this.#record("seekBy", seconds);
  }
  showVolume(percent: number | undefined) {
    this.#record("showVolume", percent);
  }
  restart() {
    this.#record("restart");
  }
  onEvent(listener: (event: YouTubeEvent) => void) {
    return this.#events.on(listener);
  }
  emit(event: YouTubeEvent) {
    this.#events.emit(event);
  }
}

export class FakeMac implements Mac {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  volume = 50;
  displays: DisplayInfo[] = [{ id: 1, label: "Built-in", internal: true }];
  /** Scripted result of the next folder pick. */
  folderPick: string | undefined;
  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
  }
  getVolume() {
    return Promise.resolve(this.volume);
  }
  setVolume(percent: number) {
    this.volume = percent;
    this.#record("setVolume", percent);
    return Promise.resolve();
  }
  keepAwake(keep: boolean) {
    this.#record("keepAwake", keep);
  }
  keepDisplayAwake(keep: boolean) {
    this.#record("keepDisplayAwake", keep);
  }
  wakeDisplay() {
    this.#record("wakeDisplay");
  }
  listDisplays() {
    return this.displays;
  }
  #displayListeners = new Set<() => void>();
  onDisplaysChanged(listener: () => void) {
    this.#displayListeners.add(listener);
    return () => void this.#displayListeners.delete(listener);
  }
  /** Change the connected displays and fire the change event. */
  setDisplays(displays: DisplayInfo[]) {
    this.displays = displays;
    for (const l of [...this.#displayListeners]) l();
  }
  moveScreenTo(displayId: number) {
    this.#record("moveScreenTo", displayId);
  }
  pickFolder() {
    this.#record("pickFolder");
    return Promise.resolve(this.folderPick);
  }
  localName() {
    return "test-mac.local";
  }
  quit() {
    this.#record("quit");
  }
}

/** A clock that only moves when a test calls `advance`. Starts at 2026-10-20 08:30 UTC. */
export class FakeClock implements Clock {
  #now = Date.UTC(2026, 9, 20, 8, 30, 0);
  #timers: Array<{ at: number; fn: () => void; every?: number; dead: boolean }> = [];

  now() {
    return this.#now;
  }
  setTimeout(fn: () => void, ms: number) {
    return this.#add(fn, ms);
  }
  setInterval(fn: () => void, ms: number) {
    return this.#add(fn, ms, ms);
  }
  #add(fn: () => void, ms: number, every?: number) {
    const timer = { at: this.#now + ms, fn, every, dead: false };
    this.#timers.push(timer);
    return () => {
      timer.dead = true;
    };
  }
  advance(ms: number) {
    const target = this.#now + ms;
    for (;;) {
      this.#timers = this.#timers.filter((t) => !t.dead);
      const next = this.#timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.#now = next.at;
      if (next.every) next.at += next.every;
      else next.dead = true;
      next.fn();
    }
    this.#now = target;
  }
}

/** Scripted thumbnails: `make` waits until a test calls `finish` (or `fail`) for that path. */
export class FakeThumbnails implements Thumbnails {
  cache = new Map<string, string>();
  started: string[] = [];
  #pending = new Map<string, (url: string | undefined) => void>();
  inFlight = 0;
  maxInFlight = 0;
  cached(path: string) {
    return this.cache.get(path);
  }
  make(path: string) {
    this.started.push(path);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    return new Promise<string | undefined>((resolve) => {
      this.#pending.set(path, (url) => {
        this.inFlight--;
        if (url) this.cache.set(path, url);
        resolve(url);
      });
    });
  }
  finish(path: string) {
    this.#pending.get(path)?.(`file:///thumbs/${encodeURIComponent(path)}.jpg`);
  }
  fail(path: string) {
    this.#pending.get(path)?.(undefined);
  }
}

/** Scripted Metadata: a catalogue keyed by title, every call recorded (with the credential it was given). */
export class FakeMetadata implements Metadata {
  /** Search results by lower-cased title, per kind. */
  catalog: Record<MetadataKind, Record<string, Candidate[]>> = { show: {}, film: {} };
  /** Details by TMDB id; a missing id is built from the search result. */
  detailsById = new Map<number, Details>();
  searches: { key: string; kind: MetadataKind; title: string; year?: number }[] = [];
  detailCalls: { key: string; kind: MetadataKind; id: number; seasons: number[] }[] = [];
  images: string[] = [];
  /** When set, every call throws it (a function can decide per call). */
  fail: MetadataError | ((key: string) => MetadataError | undefined) | undefined;
  /** When set, the next `holdLeft` searches wait for it (to model a slow lookup). */
  hold: Promise<void> | undefined;
  holdLeft = Infinity;
  #cached = new Set<string>();

  #check(key: string): void {
    const error = typeof this.fail === "function" ? this.fail(key) : this.fail;
    if (error) throw error;
  }
  search(key: string, kind: MetadataKind, title: string, year?: number) {
    this.searches.push({ key, kind, title, ...(year ? { year } : {}) });
    try {
      this.#check(key);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const results = this.catalog[kind][title.toLowerCase()] ?? [];
    return this.hold && this.holdLeft-- > 0
      ? this.hold.then(() => results)
      : Promise.resolve(results);
  }
  details(key: string, kind: MetadataKind, id: number, seasons: number[]) {
    this.detailCalls.push({ key, kind, id, seasons });
    try {
      this.#check(key);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const found = this.detailsById.get(id);
    if (found) return Promise.resolve(found);
    const hit = Object.values(this.catalog[kind])
      .flat()
      .find((c) => c.id === id);
    return Promise.resolve<Details>({
      id,
      name: hit?.name ?? `Title ${id}`,
      year: hit?.year,
      overview: hit?.overview,
      posterPath: hit?.posterPath,
      backdropPath: `/backdrop${id}.jpg`,
      genres: [],
      seasons: seasons.map((number) => ({
        number,
        episodes: [
          { number: 1, name: `S${number}E1 name`, stillPath: `/still${id}-${number}.jpg` },
        ],
      })),
    });
  }
  cachedImage(kind: ImageKind, path: string) {
    return this.#cached.has(`${kind}${path}`) ? `file:///tmdb/${kind}${path}` : undefined;
  }
  image(kind: ImageKind, path: string) {
    this.images.push(`${kind}${path}`);
    this.#cached.add(`${kind}${path}`);
    return Promise.resolve(`file:///tmdb/${kind}${path}`);
  }
}
