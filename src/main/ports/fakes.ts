import type { Thumbnails } from "./thumbnails.ts";
import type {
  ConvertedPicture,
  MacEntry,
  MacWallpapers,
  WallpaperConverter,
  WallpaperFiles,
} from "./pictures.ts";
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
import type { DisplayInfo, Mac, OutputDevice } from "./mac.ts";
import { RouteTracker, type PageState } from "../apps/youtube/youtube-route.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "./youtube.ts";
import type { App, AppEvent, AppKey, AppSignIn, AppTyping } from "../apps/app.ts";
import type { Confirmation, PromptId, RemoteLayout, TrackKind } from "../../shared/protocol.ts";

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
  setTrack(kind: "subtitles" | "audio", id: string) {
    return this.#record("setTrack", kind, id);
  }
  setSpeed(speed: number) {
    return this.#record("setSpeed", speed);
  }
  volume: number | undefined;
  /** The CoreAudio UID mpv was last pointed at; undefined is the System default. */
  audioDevice: string | undefined;
  setVolume(percent: number) {
    this.volume = percent;
    return this.#record("setVolume", percent);
  }
  /** UIDs mpv refuses to open, like a monitor that is asleep. */
  failingAudioDevices = new Set<string>();
  setAudioDevice(uid: string | undefined) {
    if (uid !== undefined && this.failingAudioDevices.has(uid)) {
      void this.#record("setAudioDevice", uid);
      return Promise.reject(new Error("audio-device refused"));
    }
    this.audioDevice = uid;
    return this.#record("setAudioDevice", uid);
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
  #tracker = new RouteTracker();
  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
  }
  /** The view's address or Shorts player changed, announced the way the real adapter does. */
  navigate(url: string, page: Partial<PageState> = {}) {
    const route = this.#tracker.update(url, { shorts: false, guide: false, ...page });
    if (route) this.emit({ type: "route", ...route });
  }
  /** Set by a test that wants idle unloading, as the real host does with its own. */
  lifecycle: { shown(): void; hidden(): void } | undefined;
  show(note?: string) {
    this.#record("show", note);
    this.lifecycle?.shown();
  }
  hide() {
    this.#record("hide");
    this.lifecycle?.hidden();
  }
  unload() {
    this.#record("unload");
    this.#tracker = new RouteTracker();
    this.emit({ type: "route", home: true });
  }
  sendKey(key: YouTubeKey) {
    this.#record("sendKey", key);
  }
  scrollToTop() {
    this.#record("scrollToTop");
  }
  seekTo(seconds: number) {
    this.#record("seekTo", seconds);
  }
  setTrack(kind: TrackKind, id: string) {
    this.#record("setTrack", kind, id);
  }
  pressPrompt(id: PromptId) {
    this.#record("pressPrompt", id);
  }
  setSpeed(speed: number) {
    this.#record("setSpeed", speed);
  }
  submitSearch(text: string) {
    this.#record("submitSearch", text);
  }
  showSearchBar(text: string | undefined) {
    this.#record("showSearchBar", text);
  }
  captureText(on: boolean) {
    this.#record("captureText", on);
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
  showConfirm(confirm: unknown) {
    this.#record("showConfirm", confirm);
  }
  volume: number | undefined;
  /** The output name the view was last pointed at; undefined is the System default. */
  outputName: string | undefined;
  /** Output names the view has no device for, like Chromium not listing a monitor. */
  unmatchedOutputs = new Set<string>();
  /** The device shows up in the view (Chromium lists it now): the view looks again and says so. */
  outputAppears(name: string) {
    this.unmatchedOutputs.delete(name);
    if (this.outputName === name) this.emit({ type: "output", name, ok: true });
  }
  setAddons(ids: string[], note?: string) {
    this.#record("setAddons", ids, note);
  }
  setVolume(percent: number) {
    this.volume = percent;
    this.#record("setVolume", percent);
  }
  setOutputDevice(name: string | undefined) {
    this.outputName = name;
    this.#record("setOutputDevice", name);
    return Promise.resolve(name === undefined || !this.unmatchedOutputs.has(name));
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

export interface FakeWebAppOptions {
  typeLabel?: string;
  showVolume?: boolean;
  showSkip?: boolean;
  /** false: the App doesn't take text. */
  typing?: boolean;
  /** false: the App has no play/pause or seek. */
  playback?: boolean;
  layout?: RemoteLayout;
  /** true: the App's adapter can seek to a point and choose tracks. */
  adapter?: boolean;
  /** The App offers Import Safari sign-in and Sign out in Settings. */
  signIn?: AppSignIn;
}

/** A second web App that is not YouTube: records what core tells it. `atHome` is what its Back answers. */
export class FakeWebApp implements App {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  #events = emitter<AppEvent>();
  atHome = true;
  /** Whether the App can find the output it is asked for. */
  outputFound = true;
  outputName: string | undefined;
  volume: number | undefined;
  readonly id: string;
  readonly label: string;
  readonly options: FakeWebAppOptions;
  readonly typing: AppTyping | undefined;
  readonly layout: RemoteLayout | undefined;
  readonly signIn: AppSignIn | undefined;
  readonly playPause: (() => void) | undefined;
  readonly seekBy: ((seconds: number) => void) | undefined;
  readonly seekTo: ((seconds: number) => void) | undefined;
  readonly setTrack: ((kind: TrackKind, id: string) => void) | undefined;
  readonly pressPrompt: ((id: PromptId) => void) | undefined;
  readonly setSpeed: ((speed: number) => void) | undefined;
  constructor(id: string, label: string, options: FakeWebAppOptions = {}) {
    this.id = id;
    this.label = label;
    this.options = options;
    this.layout = options.layout;
    this.signIn = options.signIn;
    if (options.typing !== false)
      this.typing = {
        label: options.typeLabel ?? `Search ${label}`,
        submitSearch: (text) => this.#record("submitSearch", text),
        showSearchBar: (text) => this.#record("showSearchBar", text),
        captureText: (on) => this.#record("captureText", on),
      };
    if (options.playback !== false) {
      this.playPause = () => this.#record("playPause");
      this.seekBy = (seconds) => this.#record("seekBy", seconds);
    }
    if (options.adapter) {
      this.seekTo = (seconds) => this.#record("seekTo", seconds);
      this.setTrack = (kind, id) => this.#record("setTrack", kind, id);
      this.pressPrompt = (id) => this.#record("pressPrompt", id);
      this.setSpeed = (speed) => this.#record("setSpeed", speed);
    }
  }
  get showVolume() {
    return this.options.showVolume ?? false;
  }
  get showSkip() {
    return this.options.showSkip ?? false;
  }
  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
  }
  show(note?: string) {
    this.#record("show", note);
  }
  hide() {
    this.#record("hide");
  }
  sendKey(key: AppKey) {
    this.#record("sendKey", key);
  }
  back() {
    this.#record("back");
    return this.atHome ? ("leave" as const) : ("handled" as const);
  }
  drawVolume(percent: number | undefined) {
    this.#record("drawVolume", percent);
  }
  showConfirm(confirm: Confirmation | undefined) {
    this.#record("showConfirm", confirm);
  }
  setVolume(percent: number) {
    this.volume = percent;
  }
  setOutputDevice(name: string | undefined) {
    this.outputName = name;
    return Promise.resolve(this.outputFound);
  }
  restart() {
    this.#record("restart");
  }
  onEvent(listener: (event: AppEvent) => void) {
    return this.#events.on(listener);
  }
  emit(event: AppEvent) {
    this.#events.emit(event);
  }
}

export class FakeMac implements Mac {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  outputDevices: OutputDevice[] = [
    { uid: "BuiltInSpeakerDevice", name: "MacBook Pro Speakers" },
    { uid: "30AEC067-0000-0000-1A24-0104B53C2278", name: "L27h-4A" },
  ];
  displays: DisplayInfo[] = [{ id: 1, label: "Built-in", internal: true }];
  /** Scripted result of the next folder pick. */
  folderPick: string | undefined;
  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
  }
  listOutputDevices() {
    return Promise.resolve([...this.outputDevices]);
  }
  #outputListeners = new Set<() => void>();
  onOutputDevicesChanged(listener: () => void) {
    this.#outputListeners.add(listener);
    return () => void this.#outputListeners.delete(listener);
  }
  /** Change the connected outputs and fire the change event. */
  setOutputDevices(devices: OutputDevice[]) {
    this.outputDevices = devices;
    for (const l of [...this.#outputListeners]) l();
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
  format: "12" | "24" = "12";
  #formatListeners = new Set<() => void>();
  timeFormat() {
    return this.format;
  }
  onTimeFormatChanged(listener: () => void) {
    this.#formatListeners.add(listener);
    return () => void this.#formatListeners.delete(listener);
  }
  /** Flip the Mac's 12/24-hour setting and fire the change event. */
  setTimeFormat(format: "12" | "24") {
    this.format = format;
    for (const l of [...this.#formatListeners]) l();
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
  /** Scripted login item; `available: false` is development. */
  loginItem = { available: true, on: false };
  listenerLoginItem() {
    return Promise.resolve({ ...this.loginItem });
  }
  /** Runs inside `setListenerLoginItem`, so a test can play the listener coming up or going away. */
  onLoginItemSet: ((on: boolean) => void | Promise<void>) | undefined;
  async setListenerLoginItem(on: boolean) {
    this.#record("setListenerLoginItem", on);
    if (this.loginItem.available) this.loginItem.on = on;
    await this.onLoginItemSet?.(on);
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

/** A file the fake Mac lists. */
export const macFile = (
  dir: string,
  name: string,
  extra: Partial<Pick<MacEntry, "kind" | "size" | "mtimeMs" | "dev" | "ino">> = {},
): MacEntry => ({
  name,
  path: `${dir}/${name}`,
  kind: "file",
  size: 1000,
  mtimeMs: 1_000_000,
  ...extra,
});

/** The Mac's wallpaper sources, scripted: folders by path, the desktop picture, Apple's folder and what the chooser returns. */
export class FakeMacWallpapers implements MacWallpapers {
  folders = new Map<string, MacEntry[]>();
  desktop: MacEntry | undefined;
  apple: MacEntry[] = [];
  /** What the folder chooser returns next (undefined: cancelled). */
  chooses: string | undefined;
  choosers: string[] = [];
  desktopReads = 0;
  /** While set, `desktopPicture()` stays pending until `release()`: the real read takes a moment. */
  hold = false;
  #held: Array<() => void> = [];
  release() {
    this.hold = false;
    for (const f of this.#held.splice(0)) f();
  }
  defaultFolder() {
    return "/Users/me/Pictures/Wallpapers";
  }
  listFolder(path: string) {
    return this.folders.get(path);
  }
  async desktopPicture() {
    this.desktopReads++;
    if (this.hold) await new Promise<void>((r) => this.#held.push(r));
    return this.desktop;
  }
  appleWallpapers() {
    return this.apple;
  }
  chooseFolder(current: string) {
    this.choosers.push(current);
    return Promise.resolve(this.chooses);
  }
}

/**
 * Converts by path: the result's bytes name the source, and brightness comes from `brightness` (default 0.5).
 * Paths in `fails` don't pass the checks.
 */
export class FakeConverter implements WallpaperConverter {
  converted: string[] = [];
  fails = new Set<string>();
  brightness = new Map<string, number>();
  /** Paths whose conversion stays pending until `release(path)`. */
  holds = new Set<string>();
  #held = new Map<string, () => void>();
  /** Conversions started and not yet finished. */
  running = 0;
  maxRunning = 0;
  release(path: string) {
    this.holds.delete(path);
    this.#held.get(path)?.();
    this.#held.delete(path);
  }
  async convert(path: string): Promise<ConvertedPicture | undefined> {
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    this.started.push(path);
    try {
      if (this.holds.has(path)) await new Promise<void>((r) => this.#held.set(path, r));
    } finally {
      this.running--;
    }
    if (this.fails.has(path)) return undefined;
    this.converted.push(path);
    return {
      jpeg: Buffer.from(`jpeg:${path}`),
      thumb: Buffer.from(`thumb:${path}`),
      brightness: this.brightness.get(path) ?? 0.5,
    };
  }
  started: string[] = [];
}

/** The converted copies, kept in memory. */
export class FakeWallpaperFiles implements WallpaperFiles {
  files = new Map<string, { jpeg: Buffer; thumb: Buffer }>();
  has(key: string) {
    return this.files.has(key);
  }
  save(key: string, jpeg: Buffer, thumb: Buffer) {
    this.files.set(key, { jpeg, thumb });
  }
  remove(key: string) {
    this.files.delete(key);
  }
  keys() {
    return [...this.files.keys()];
  }
  url(key: string) {
    return `file:///userData/wallpapers/${key}.jpg`;
  }
  thumbUrl(key: string) {
    return `file:///userData/wallpapers/${key}.thumb.jpg`;
  }
}
