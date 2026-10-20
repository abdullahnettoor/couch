import { existsSync } from "node:fs";
import { dirname, basename } from "node:path";
import {
  VIEW_LABELS,
  type LibraryEntry,
  type LibraryPayload,
  type Command,
  type GridItem,
  type RemoteId,
  type RemoteSnapshot,
  type ScreenPayload,
  type ScreenState,
  type View,
} from "../../shared/protocol.ts";
import {
  formatTime,
  type Player,
  type PlayerEvent,
  type PlayerOverlay,
} from "../../shared/player.ts";
import type { Clock } from "../ports/clock.ts";
import type { Mac } from "../ports/mac.ts";
import { pickTargetDisplay } from "../display.ts";
import type { YouTube, YouTubeEvent } from "../ports/youtube.ts";
import { randomBytes } from "node:crypto";
import type { Store } from "../ports/store.ts";
import { nullThumbnails, type Thumbnails } from "../ports/thumbnails.ts";
import { ACTIONS, BACK_TARGETS, type ActionContext } from "./actions.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import { cleanTitle, hueFor, listFolder, mosaicSources, rootEntries } from "./library.ts";
import { History } from "./history.ts";

const TILE_COLUMNS = 4;
const THUMBNAIL_JOBS = 2;
const LIBRARY_VIEWS = ["library", "folder", "libraryFolders"];

export interface Ports {
  player: Player;
  youtube: YouTube;
  mac: Mac;
  clock: Clock;
  store: Store;
  thumbnails?: Thumbnails;
}

/** Who sent a command: a connected phone, or the Screen's own keyboard. */
export type Source = RemoteId | "screen";

const TOAST_MS = 3000;
const IDLE_DISPLAY_MS = 30 * 60_000;
const SKIP_SECONDS = 10;
const OVERLAY_MS = 3000;
const SAVE_EVERY_MS = 5000;
const MPV_MISSING = "Couch needs mpv to play videos. Install it with: brew install mpv";
const VOLUME_STEP = 5;
const TYPING_HINT = "Typing works inside YouTube search";
const YOUTUBE_NOTE = "Press Home on your phone to come back";

/** The single source of truth: holds the Screen state and turns commands into new state. */
export class Core {
  #ports: Ports;
  #state: ScreenState = {
    view: "home",
    focus: {},
    query: "",
    subtitlesOn: true,
    volume: 0,
    remotes: 0,
  };
  #grids = new Map<string, GridItem[]>();
  #remotes = new Set<RemoteId>();
  #listeners = new Set<() => void>();
  #cancelToast: (() => void) | undefined;
  #cancelMinute: (() => void) | undefined;
  #key: string;
  #port = 0;
  #forgetListeners = new Set<() => void>();
  #ytFailed = false;
  #lastFrom: RemoteId | undefined;
  #ytTopLevel = true;
  #ytOff: () => void;
  #libraryFolders: string[];
  /** The open folder's contents, read fresh each time it is opened. */
  #listing: LibraryEntry[] = [];
  /** Where the playing video was started from; leaving playback returns there. */
  #playedFrom: View = "folder";
  #mpvMissing = false;
  #overlayShown = false;
  #cancelOverlay: (() => void) | undefined;
  #cancelVolume: (() => void) | undefined;
  #subtitlesRaised = false;
  #unsubPlayer: () => void;
  #thumbQueue: string[] = [];
  #thumbUrls = new Map<string, string>();
  #thumbBusy = new Set<string>();
  #mosaics = new Map<string, { sources: string[]; count: number }>();
  #rootKey: string | undefined;
  #thumbRunning = 0;
  #disposed = false;
  #history: History;
  #cancelSaves: (() => void) | undefined;
  #resumeNote: string | undefined;
  #cancelNote: (() => void) | undefined;
  #displayId: number | undefined;
  #unsubDisplays: () => void;
  #shownYtVolume: number | undefined;
  #idle = false;
  #cancelIdle: (() => void) | undefined;
  #displayAwake: boolean | undefined;

  constructor(ports: Ports) {
    this.#ports = ports;
    const lib = ports.store.read<{ folders?: unknown }>("library", {});
    this.#history = new History(ports.store);
    this.#libraryFolders = Array.isArray(lib.folders)
      ? lib.folders.filter((f): f is string => typeof f === "string")
      : [];
    const saved = ports.store.read<{ key?: string }>("pairing", {});
    this.#key = typeof saved.key === "string" && saved.key ? saved.key : this.#newKey();
    const playback = ports.store.read<{ subtitlesOn?: unknown }>("playback", {});
    this.#state.subtitlesOn = playback.subtitlesOn !== false;
    this.#unsubPlayer = ports.player.onEvent((event) => this.#onPlayerEvent(event));
    this.#scheduleMinute();
    this.#displayId = pickTargetDisplay(ports.mac.listDisplays())?.id;
    this.#unsubDisplays = ports.mac.onDisplaysChanged(() => this.#retarget());
    this.#armIdle();
    this.#syncDisplayAwake();
    this.#ytOff = ports.youtube.onEvent((event) => this.#onYouTube(event));
    void ports.mac
      .getVolume()
      .then((volume) => {
        this.#state.volume = volume;
        this.#emit();
      })
      .catch(() => {});
  }

  #newKey(): string {
    const key = randomBytes(16).toString("base64url");
    this.#ports.store.write("pairing", { key });
    return key;
  }

  /** The Remote server tells the core which port it listens on, for the QR code. */
  setPort(port: number): void {
    this.#port = port;
  }

  acceptsKey(key: string | null | undefined): boolean {
    return typeof key === "string" && key.length > 0 && key === this.#key;
  }

  get pairingUrl(): string {
    return `http://${this.#ports.mac.localName()}:${this.#port}/?key=${this.#key}`;
  }

  /** Called when every phone must be dropped (the key changed). */
  onForget(listener: () => void): () => void {
    this.#forgetListeners.add(listener);
    return () => void this.#forgetListeners.delete(listener);
  }

  forgetAllPhones(): void {
    this.#key = this.#newKey();
    this.#remotes.clear();
    this.#state.remotes = 0;
    this.#state.typingBy = undefined;
    for (const l of [...this.#forgetListeners]) l();
    this.#setView("addPhone");
    this.#emit();
  }

  get viewKey(): string {
    const { view, folderPath } = this.#state;
    return view === "folder" ? `folder:${folderPath}` : view;
  }

  #isLibraryView(): boolean {
    return LIBRARY_VIEWS.includes(this.#state.view);
  }

  /** The Library views are built here from disk; other views' grids come from the renderer. */
  #library(): LibraryPayload | undefined {
    switch (this.#state.view) {
      case "library":
        return {
          heading: "Library",
          entries: rootEntries(this.#libraryFolders).map((e) => this.#withMosaic(e)),
          continueWatching: this.#continueEntries(),
          emptyText: "No folders yet. Add one in Settings on the Mac.",
        };
      case "folder":
        return {
          heading: basename(this.#state.folderPath ?? ""),
          entries: this.#listing.map((e) => this.#withMosaic(this.#decorate(e))),
          emptyText: "No videos in this folder.",
        };
      case "libraryFolders":
        return { heading: "Library folders", entries: [], folders: this.#libraryFolders };
      default:
        return undefined;
    }
  }

  /** A video entry with its watched tag or progress, from the history. */
  #decorate(entry: LibraryEntry): LibraryEntry {
    if (entry.kind !== "video") return entry;
    const progress = this.#history.progress(entry.path);
    if (progress) {
      const left = Math.max(1, Math.ceil((progress.duration - progress.position) / 60));
      return {
        ...entry,
        progress: { fraction: progress.position / progress.duration, left: `${left} min left` },
      };
    }
    return this.#history.isWatched(entry.path) ? { ...entry, watched: true } : entry;
  }

  /** A video's picture, or a folder's mosaic and count, from what has been made so far. */
  #withMosaic(entry: LibraryEntry): LibraryEntry {
    if (entry.kind === "video") {
      const thumb = this.#thumbUrls.get(entry.path);
      return thumb ? { ...entry, thumb } : entry;
    }
    const m = this.#mosaics.get(entry.path);
    if (!m || entry.missing) return entry;
    const mosaic = m.sources.flatMap((p) => this.#thumbUrls.get(p) ?? []);
    return { ...entry, count: m.count, ...(mosaic.length ? { mosaic } : {}) };
  }

  /** On arriving at the Library's first page, finds each folder's mosaic sources and queues their pictures. */
  #syncRoot(): void {
    if (this.#state.view !== "library") {
      this.#rootKey = undefined;
      return;
    }
    const key = this.#libraryFolders.join("\0");
    if (this.#rootKey === key) return;
    this.#rootKey = key;
    this.#mosaics.clear();
    const paths: string[] = [];
    for (const f of this.#libraryFolders) {
      if (!existsSync(f)) continue;
      const m = mosaicSources(f);
      this.#mosaics.set(f, m);
      paths.push(...m.sources);
    }
    this.#queueThumbnails(paths);
  }

  #continueEntries(): LibraryEntry[] {
    return this.#history.continueWatching().map((c) => {
      const title = cleanTitle(basename(c.path));
      return this.#decorate({
        kind: "video",
        path: c.path,
        title,
        hue: hueFor(title),
        folder: basename(dirname(c.path)),
      });
    });
  }

  #currentGrid(): GridItem[] {
    if (this.#state.view === "home") {
      const base = this.#grids.get("home") ?? [];
      const first = base.length ? this.#continueEntries()[0] : undefined;
      if (!first) return base;
      const apps = base.filter((i) => i.id !== "settings");
      const row = apps.length ? apps[0]!.r : 1;
      const col = Math.max(-1, ...apps.map((i) => i.c)) + 1;
      return [
        ...base,
        {
          id: "continue",
          r: row,
          c: col,
          label: first.title,
          action: `library:play:${first.path}`,
        },
      ];
    }
    if (!this.#isLibraryView()) return this.#grids.get(this.viewKey) ?? [];
    const lib = this.#library()!;
    if (lib.folders) {
      return [
        { id: "add", r: 0, c: 0, label: "Add folder", action: "library:add", initial: true },
        ...lib.folders.map((f, i) => ({
          id: f,
          r: i + 1,
          c: 0,
          label: f,
          action: `library:remove:${f}`,
        })),
      ];
    }
    const cont = lib.continueWatching ?? [];
    const tile = (e: LibraryEntry, r: number, c: number, initial: boolean): GridItem => ({
      id: e.path,
      r,
      c,
      label: e.title,
      action: e.missing
        ? "library:missing"
        : e.kind === "folder"
          ? `library:open:${e.path}`
          : `library:play:${e.path}`,
      initial,
    });
    if (cont.length) {
      return [
        ...cont.map((e, i) => tile(e, 0, i, i === 0)),
        ...lib.entries.map((e, i) =>
          tile(e, 1 + Math.floor(i / TILE_COLUMNS), i % TILE_COLUMNS, false),
        ),
      ];
    }
    return lib.entries.map((e, i) =>
      tile(e, Math.floor(i / TILE_COLUMNS), i % TILE_COLUMNS, i === 0),
    );
  }

  #openFolder(path: string): void {
    const entries = listFolder(path);
    if (!entries) return this.#toast("Connect the drive to see this folder");
    this.#listing = entries;
    this.#mosaics.clear();
    const paths = entries.filter((e) => e.kind === "video").map((e) => e.path);
    for (const e of entries) {
      if (e.kind !== "folder") continue;
      const m = mosaicSources(e.path);
      this.#mosaics.set(e.path, m);
      paths.push(...m.sources);
    }
    this.#queueThumbnails(paths);
    this.#state.folderPath = path;
    this.#state.view = "folder";
  }

  /** Cached pictures appear at once; the rest are made in the background, a couple at a time. */
  #queueThumbnails(paths: string[]): void {
    const thumbs = this.#ports.thumbnails ?? nullThumbnails;
    this.#thumbQueue = [];
    for (const path of new Set(paths)) {
      if (this.#thumbUrls.has(path) || this.#thumbBusy.has(path)) continue;
      const url = thumbs.cached(path);
      if (url) this.#thumbUrls.set(path, url);
      else this.#thumbQueue.push(path);
    }
    this.#pumpThumbnails();
  }

  #pumpThumbnails(): void {
    const thumbs = this.#ports.thumbnails ?? nullThumbnails;
    while (!this.#disposed && this.#thumbRunning < THUMBNAIL_JOBS && this.#thumbQueue.length) {
      const path = this.#thumbQueue.shift()!;
      this.#thumbRunning++;
      this.#thumbBusy.add(path);
      void thumbs
        .make(path)
        .catch(() => undefined)
        .then((url) => {
          this.#thumbRunning--;
          this.#thumbBusy.delete(path);
          if (url && !this.#disposed) {
            this.#thumbUrls.set(path, url);
            this.#emit();
          }
          this.#pumpThumbnails();
        });
    }
  }

  #libraryAction(action: string): boolean {
    if (!action.startsWith("library:")) return false;
    const [, verb, ...rest] = action.split(":");
    const arg = rest.join(":");
    if (verb === "missing") this.#toast("Connect the drive to see this folder");
    else if (verb === "open") this.#openFolder(arg);
    else if (verb === "play") this.#play(arg);
    else if (verb === "remove") this.#saveFolders(this.#libraryFolders.filter((f) => f !== arg));
    else if (verb === "add") {
      void this.#ports.mac
        .pickFolder()
        .then((path) => {
          if (path && !this.#libraryFolders.includes(path))
            this.#saveFolders([...this.#libraryFolders, path]);
          this.#emit();
        })
        .catch(() => {});
    } else return false;
    return true;
  }

  /** Start a Library video full screen, resuming where it was left. */
  #play(path: string): void {
    if (this.#mpvMissing) return this.#toast(MPV_MISSING);
    // Continue watching (Home or the Library row) returns there, not into the video's folder.
    this.#playedFrom = this.#state.view === "folder" ? "folder" : this.#state.view;
    if (this.#playedFrom === "folder") this.#focusEntry(path);
    const startSeconds = this.#history.resumeAt(path);
    this.#state.player = { path, pos: startSeconds ?? 0, dur: 0, paused: false };
    this.#state.view = "player";
    this.#showOverlay();
    this.#cancelNote?.();
    this.#resumeNote = undefined;
    if (startSeconds !== undefined) {
      this.#resumeNote = `Resumed at ${formatTime(startSeconds)}`;
      this.#cancelNote = this.#ports.clock.setTimeout(() => {
        this.#resumeNote = undefined;
        this.#emit();
      }, OVERLAY_MS);
    }
    this.#cancelSaves?.();
    this.#cancelSaves = this.#ports.clock.setInterval(
      () => this.savePlayingPosition(),
      SAVE_EVERY_MS,
    );
    this.#ports.player
      .load(path, { subtitles: this.#state.subtitlesOn, startSeconds })
      .catch(() => this.#endPlayback("Couldn't play this video"));
  }

  /** Save where the playing video is (no-op when nothing plays). Also called on quit and display changes. */
  savePlayingPosition(): void {
    const p = this.#state.player;
    if (p) this.#history.save(p.path, p.pos, p.dur, this.#ports.clock.now());
  }

  /** Focus a video's tile in the open folder, if listed. */
  #focusEntry(path: string, next = false): void {
    let index = this.#listing.findIndex((e) => e.path === path);
    if (index === -1) return;
    if (next) {
      const after = this.#listing.slice(index + 1).findIndex((e) => e.kind === "video");
      if (after !== -1) index += 1 + after;
    }
    this.#state.focus[`folder:${this.#state.folderPath}`] = {
      r: Math.floor(index / TILE_COLUMNS),
      c: index % TILE_COLUMNS,
    };
  }

  /** Leave playback for a view, saving the position first. */
  #endPlayback(toast?: string, ended = false): void {
    const p = this.#state.player;
    if (!p) return;
    this.#cancelSaves?.();
    this.#cancelSaves = undefined;
    this.#cancelNote?.();
    this.#resumeNote = undefined;
    this.#history.save(p.path, p.pos, p.dur, this.#ports.clock.now(), ended);
    this.#state.player = undefined;
    this.#overlayShown = false;
    this.#cancelOverlay?.();
    if (this.#playedFrom === "folder") {
      this.#focusEntry(p.path, ended);
      this.#state.view = this.#state.folderPath ? "folder" : "library";
    } else {
      this.#state.view = this.#playedFrom;
    }
    if (toast) this.#toast(toast);
    this.#emit();
  }

  #stopPlayback(): void {
    void this.#ports.player.stop().catch(() => {});
  }

  #onPlayerEvent(event: PlayerEvent): void {
    const p = this.#state.player;
    switch (event.type) {
      case "missing":
        this.#mpvMissing = true;
        if (p) this.#endPlayback(MPV_MISSING);
        break;
      case "exited":
        if (p) this.#endPlayback("mpv stopped unexpectedly");
        break;
      case "key":
        this.handle({ command: event.command }, "screen");
        break;
      case "ended":
        // Our own stops report "stop"; only a natural end or a failure leaves playback.
        if (event.reason === "eof") this.#endPlayback(undefined, true);
        else if (event.reason === "error") this.#endPlayback("Couldn't play this video");
        break;
      case "position": {
        if (!p) break;
        const changed = Math.floor(event.seconds) !== Math.floor(p.pos);
        p.pos = event.seconds;
        if (changed) this.#emit();
        break;
      }
      case "duration":
        if (p) {
          p.dur = event.seconds;
          this.#emit();
        }
        break;
      case "pause":
        if (p && p.paused !== event.paused) {
          p.paused = event.paused;
          this.#emit();
        }
        break;
    }
  }

  /** Commands while a video plays. Returns false for the ones handled like anywhere else. */
  #playbackCommand(command: Command): boolean {
    const p = this.#state.player!;
    const player = this.#ports.player;
    const quiet = (promise: Promise<void>) => void promise.catch(() => {});
    const seekTo = (seconds: number) => {
      const max = p.dur > 0 ? p.dur : Infinity;
      p.pos = Math.min(max, Math.max(0, seconds));
      quiet(player.seekTo(p.pos));
      this.#showOverlay();
    };
    switch (command.command) {
      case "left":
        seekTo(p.pos - SKIP_SECONDS);
        return true;
      case "right":
        seekTo(p.pos + SKIP_SECONDS);
        return true;
      case "up":
      case "down":
        this.#showOverlay();
        return true;
      case "ok":
      case "playpause":
        p.paused = !p.paused;
        quiet(player.setPaused(p.paused));
        this.#showOverlay();
        return true;
      case "seekBy":
        seekTo(p.pos + (command.args?.seconds ?? 0));
        return true;
      case "seekTo":
        seekTo(command.args?.seconds ?? 0);
        return true;
      case "subtitles":
        this.#state.subtitlesOn = !this.#state.subtitlesOn;
        this.#ports.store.write("playback", { subtitlesOn: this.#state.subtitlesOn });
        quiet(player.setSubtitles(this.#state.subtitlesOn));
        return true;
      case "back":
        this.#stopPlayback();
        this.#endPlayback();
        return true;
      case "home":
        this.#stopPlayback();
        this.#endPlayback();
        this.#state.view = "home";
        return true;
      default:
        return false;
    }
  }

  #showOverlay(): void {
    this.#overlayShown = true;
    this.#cancelOverlay?.();
    this.#cancelOverlay = this.#ports.clock.setTimeout(() => {
      this.#overlayShown = false;
      this.#emit();
    }, OVERLAY_MS);
  }

  /** What the renderer should draw over the video right now. */
  #overlay(): PlayerOverlay | undefined {
    const p = this.#state.player;
    if (!p) return undefined;
    return {
      title: cleanTitle(basename(p.path)),
      bar: this.#overlayShown ? { position: p.pos, duration: p.dur } : undefined,
      paused: p.paused,
      note: this.#resumeNote,
      volume: this.#state.volumeShown ? this.#state.volume : undefined,
    };
  }

  #saveFolders(folders: string[]): void {
    this.#libraryFolders = folders;
    this.#ports.store.write("library", { folders });
  }

  /** Everything the Screen renderer needs to draw. */
  screen(): ScreenPayload {
    this.#syncRoot();
    const grid = this.#currentGrid();
    const focused = resolveFocus(grid, this.#state.focus[this.viewKey]);
    return {
      library: this.#library(),
      continueCard: this.#continueEntries()[0],
      overlay: this.#overlay(),
      state: structuredClone(this.#state),
      viewKey: this.viewKey,
      grid,
      focusedId: focused?.id,
      focusedLabel: focused?.label,
      pairingUrl: this.pairingUrl,
      now: this.#ports.clock.now(),
    };
  }

  snapshot(remote: RemoteId): RemoteSnapshot {
    const s = this.#state;
    return {
      type: "snapshot",
      where: s.view === "folder" ? basename(s.folderPath ?? "") : VIEW_LABELS[s.view],
      view: s.view,
      typeAvailable: s.view === "youtube",
      showVolume: s.view === "youtube",
      showSkip: s.view === "youtube",
      typing: s.typingBy === undefined ? "none" : s.typingBy === remote ? "you" : "other",
      nowPlaying: s.player && {
        title: cleanTitle(basename(s.player.path)),
        folder: basename(dirname(s.player.path)),
        position: s.player.pos,
        duration: s.player.dur,
        paused: s.player.paused,
        subtitlesOn: s.subtitlesOn,
      },
      volume: s.volume,
      remotes: s.remotes,
    };
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  connect(remote: RemoteId): void {
    this.#remotes.add(remote);
    this.#state.remotes = this.#remotes.size;
    this.#toast("Phone connected");
    this.#emit();
  }

  disconnect(remote: RemoteId): void {
    if (!this.#remotes.delete(remote)) return;
    this.#state.remotes = this.#remotes.size;
    if (this.#state.typingBy === remote) this.#state.typingBy = undefined;
    this.#emit();
  }

  /** The renderer reports the grid of focusable items it drew for a view. */
  reportGrid(viewKey: string, items: GridItem[]): void {
    this.#grids.set(viewKey, items);
    this.#emit();
  }

  handle(command: Command, from: Source): void {
    if (command.command === "focusAt" && from !== "screen") return;
    if (from !== "screen") this.#lastFrom = from;
    this.#ports.mac.wakeDisplay();
    this.#armIdle();
    if (command.command === "focusAt") return this.#focusAt(command.args?.r, command.args?.c);
    if (this.#state.player && this.#playbackCommand(command)) {
      this.#emit();
      return;
    }
    switch (command.command) {
      case "up":
      case "down":
      case "left":
      case "right":
        this.#move(command.command);
        break;
      case "ok":
        this.#ok();
        break;
      case "back":
        this.#back();
        break;
      case "home":
        this.#setView("home");
        break;
      case "playpause":
        if (this.#state.view === "youtube") this.#ports.youtube.playPause();
        break;
      case "seekBy":
        if (this.#state.view === "youtube") this.#ports.youtube.seekBy(command.args?.seconds ?? 0);
        break;
      case "volUp":
      case "volDown":
        void this.#nudgeVolume(command.command === "volUp" ? VOLUME_STEP : -VOLUME_STEP);
        break;
      case "typeOpen":
      case "typeText":
      case "typeSubmit":
      case "typeCancel":
        this.#type(command, from);
        break;
      default:
        break;
    }
    this.#emit();
  }

  #type(command: Command, from: Source): void {
    const yt = this.#ports.youtube;
    const owner = this.#state.typingBy;
    switch (command.command) {
      case "typeOpen":
        if (this.#state.view !== "youtube") return this.#toast(TYPING_HINT);
        if (from === "screen" || (owner !== undefined && owner !== from)) return;
        this.#state.typingBy = from;
        this.#state.query = "";
        yt.openSearch();
        break;
      case "typeText":
        if (owner !== from) return;
        this.#state.query = command.args?.text ?? "";
        yt.setSearchText(this.#state.query);
        break;
      case "typeSubmit":
        if (owner !== from) return;
        yt.submitSearch();
        this.#state.typingBy = undefined;
        break;
      case "typeCancel":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        break;
    }
  }

  /** ⌘Q and Settings → Quit: end playback (saving the position) and stop the player. */
  beforeQuit(): void {
    if (this.#state.player) {
      this.#stopPlayback();
      this.#endPlayback();
    }
  }

  #armIdle(): void {
    this.#cancelIdle?.();
    this.#idle = false;
    this.#cancelIdle = this.#ports.clock.setTimeout(() => {
      this.#idle = true;
      this.#syncDisplayAwake();
    }, IDLE_DISPLAY_MS);
  }

  /** Hold the display awake while playing, in YouTube, or within 30 minutes of the last command. */
  #syncDisplayAwake(): void {
    const keep = !!this.#state.player || this.#state.view === "youtube" || !this.#idle;
    if (keep === this.#displayAwake) return;
    this.#displayAwake = keep;
    this.#ports.mac.keepDisplayAwake(keep);
  }

  #retarget(): void {
    const target = pickTargetDisplay(this.#ports.mac.listDisplays());
    if (!target || target.id === this.#displayId) return;
    this.#displayId = target.id;
    this.#ports.mac.moveScreenTo(target.id);
    this.#ports.player.setDisplay(target.label || undefined).catch(() => {
      if (!this.#state.player) return;
      this.#stopPlayback();
      this.#endPlayback("Display changed, playback stopped");
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubDisplays();
    this.#cancelIdle?.();
    this.#cancelToast?.();
    this.#cancelMinute?.();
    this.#cancelOverlay?.();
    this.#cancelSaves?.();
    this.#cancelNote?.();
    this.#cancelVolume?.();
    this.#unsubPlayer();
    this.#ytOff();
    this.#listeners.clear();
  }

  #move(direction: "up" | "down" | "left" | "right"): void {
    const grid = this.#currentGrid();
    const current = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (this.#state.view === "youtube") return this.#ports.youtube.sendKey(direction);
    if (!current) return;
    const next = moveFocus(grid, current, direction);
    this.#state.focus[this.viewKey] = { r: next.r, c: next.c };
  }

  #focusAt(r?: number, c?: number): void {
    if (this.#state.view === "youtube" || this.#state.view === "player") return;
    const item = this.#currentGrid().find((i) => i.r === r && i.c === c);
    if (!item) return;
    this.#state.focus[this.viewKey] = { r: item.r, c: item.c };
    this.#emit();
  }

  #ok(): void {
    if (this.#state.view === "youtube") return this.#ports.youtube.sendKey("ok");
    const grid = this.#currentGrid();
    const item = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!item) return;
    if (item.action === "back") return this.#back();
    if (this.#libraryAction(item.action)) return;
    const action = ACTIONS[item.action];
    // Placeholder Apps until they exist.
    if (action) action(this.#actionContext());
    else this.#toast(`${item.label} is coming soon`);
  }

  #back(): void {
    if (this.#state.view === "youtube") {
      if (this.#ytTopLevel) this.#setView("home");
      else this.#ports.youtube.sendKey("back");
      return;
    }
    if (this.#state.view === "folder") {
      const path = this.#state.folderPath ?? "";
      if (
        this.#libraryFolders.includes(path) ||
        !this.#libraryFolders.some((f) => path.startsWith(f))
      )
        this.#state.view = "library";
      else this.#openFolder(dirname(path));
      return;
    }
    const target = BACK_TARGETS[this.#state.view];
    if (target) this.#setView(target);
  }

  /** Changes view; leaving YouTube hides it (pausing playback) and lets the display sleep again. */
  #setView(view: View): void {
    const from = this.#state.view;
    if (from === view) return;
    if (from === "youtube") {
      this.#state.typingBy = undefined;
      this.#ports.youtube.hide();
    }
    this.#state.view = view;
  }

  #openYouTube(): void {
    if (this.#ytFailed) {
      this.#setView("youtubeError");
      return;
    }
    this.#setView("youtube");
    this.#ports.youtube.show(YOUTUBE_NOTE);
  }

  #retryYouTube(): void {
    this.#ytFailed = false;
    this.#ports.youtube.restart();
    this.#openYouTube();
  }

  #onYouTube(event: YouTubeEvent): void {
    switch (event.type) {
      case "loaded":
        this.#ytFailed = false;
        break;
      case "failed":
        this.#ytFailed = true;
        this.#setView(this.#state.view === "youtube" ? "youtubeError" : this.#state.view);
        break;
      case "key":
        this.handle({ command: event.command }, "screen");
        return;
      case "route":
        this.#ytTopLevel = event.topLevel;
        break;
      case "searchOpened":
        if (
          this.#state.view === "youtube" &&
          this.#state.typingBy === undefined &&
          this.#lastFrom !== undefined &&
          this.#remotes.has(this.#lastFrom)
        ) {
          this.#state.typingBy = this.#lastFrom;
          this.#state.query = "";
        } else if (this.#state.typingBy !== undefined && this.#state.query) {
          this.#ports.youtube.setSearchText(this.#state.query);
        }
        break;
      default:
        return;
    }
    this.#emit();
  }

  /** YouTube covers the Screen's own volume badge, so the port draws the level above it. */
  #syncYouTubeVolume(): void {
    const level =
      this.#state.view === "youtube" && this.#state.volumeShown ? this.#state.volume : undefined;
    if (level === this.#shownYtVolume) return;
    this.#shownYtVolume = level;
    this.#ports.youtube.showVolume(level);
  }

  async #nudgeVolume(delta: number): Promise<void> {
    const volume = Math.max(0, Math.min(100, this.#state.volume + delta));
    this.#state.volume = volume;
    this.#state.volumeShown = true;
    this.#cancelVolume?.();
    this.#cancelVolume = this.#ports.clock.setTimeout(() => {
      this.#state.volumeShown = false;
      this.#emit();
    }, OVERLAY_MS);
    this.#emit();
    await this.#ports.mac.setVolume(volume).catch(() => {});
  }

  #actionContext(): ActionContext {
    return {
      open: (view) => this.#setView(view),
      openYouTube: () => this.#openYouTube(),
      retryYouTube: () => this.#retryYouTube(),
      restartYouTube: () => {
        this.#ytFailed = false;
        this.#ports.youtube.restart();
        this.#toast("Restarting YouTube");
      },
      toast: (text) => this.#toast(text),
      forgetAllPhones: () => this.forgetAllPhones(),
      quit: () => {
        this.savePlayingPosition();
        this.#ports.mac.quit();
      },
    };
  }

  #toast(text: string): void {
    this.#cancelToast?.();
    this.#state.toast = text;
    this.#cancelToast = this.#ports.clock.setTimeout(() => {
      this.#state.toast = undefined;
      this.#emit();
    }, TOAST_MS);
  }

  /** Re-emit on each minute boundary so the Home clock moves. */
  #scheduleMinute(): void {
    const wait = 60_000 - (this.#ports.clock.now() % 60_000);
    this.#cancelMinute = this.#ports.clock.setTimeout(() => {
      this.#emit();
      this.#scheduleMinute();
    }, wait);
  }

  #emit(): void {
    const raised = this.#overlayShown && this.#state.player !== undefined;
    if (raised !== this.#subtitlesRaised) {
      this.#subtitlesRaised = raised;
      this.#ports.player.setSubtitlesRaised(raised);
    }
    this.#syncDisplayAwake();
    this.#syncYouTubeVolume();
    for (const l of [...this.#listeners]) l();
  }
}
