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
import type { Player, PlayerEvent, PlayerOverlay } from "../../shared/player.ts";
import type { Clock } from "../ports/clock.ts";
import type { Mac } from "../ports/mac.ts";
import type { YouTube, YouTubeEvent } from "../ports/youtube.ts";
import { randomBytes } from "node:crypto";
import type { Store } from "../ports/store.ts";
import { nullThumbnails, type Thumbnails } from "../ports/thumbnails.ts";
import { ACTIONS, BACK_TARGETS, type ActionContext } from "./actions.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import { cleanTitle, listFolder, rootEntries } from "./library.ts";

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
const SKIP_SECONDS = 10;
const OVERLAY_MS = 3000;
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
  #mpvMissing = false;
  #overlayShown = false;
  #cancelOverlay: (() => void) | undefined;
  #cancelVolume: (() => void) | undefined;
  #lastOverlay = "";
  #unsubPlayer: () => void;
  #thumbQueue: LibraryEntry[] = [];
  #thumbRunning = 0;
  #disposed = false;

  constructor(ports: Ports) {
    this.#ports = ports;
    const lib = ports.store.read<{ folders?: unknown }>("library", {});
    this.#libraryFolders = Array.isArray(lib.folders)
      ? lib.folders.filter((f): f is string => typeof f === "string")
      : [];
    const saved = ports.store.read<{ key?: string }>("pairing", {});
    this.#key = typeof saved.key === "string" && saved.key ? saved.key : this.#newKey();
    const playback = ports.store.read<{ subtitlesOn?: unknown }>("playback", {});
    this.#state.subtitlesOn = playback.subtitlesOn !== false;
    this.#unsubPlayer = ports.player.onEvent((event) => this.#onPlayerEvent(event));
    this.#scheduleMinute();
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
          entries: rootEntries(this.#libraryFolders),
          emptyText: "No folders yet. Add one in Settings on the Mac.",
        };
      case "folder":
        return {
          heading: basename(this.#state.folderPath ?? ""),
          entries: this.#listing,
          emptyText: "No videos in this folder.",
        };
      case "libraryFolders":
        return { heading: "Library folders", entries: [], folders: this.#libraryFolders };
      default:
        return undefined;
    }
  }

  #currentGrid(): GridItem[] {
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
    return lib.entries.map((e, i) => ({
      id: e.path,
      r: Math.floor(i / TILE_COLUMNS),
      c: i % TILE_COLUMNS,
      label: e.title,
      action: e.missing
        ? "library:missing"
        : e.kind === "folder"
          ? `library:open:${e.path}`
          : `library:play:${e.path}`,
      initial: i === 0,
    }));
  }

  #openFolder(path: string): void {
    const entries = listFolder(path);
    if (!entries) return this.#toast("Connect the drive to see this folder");
    this.#listing = entries;
    this.#queueThumbnails(entries);
    this.#state.folderPath = path;
    this.#state.view = "folder";
  }

  /** Cached pictures appear at once; the rest are made in the background, a couple at a time. */
  #queueThumbnails(entries: LibraryEntry[]): void {
    const thumbs = this.#ports.thumbnails ?? nullThumbnails;
    this.#thumbQueue = [];
    for (const e of entries) {
      if (e.kind !== "video") continue;
      const url = thumbs.cached(e.path);
      if (url) e.thumb = url;
      else this.#thumbQueue.push(e);
    }
    this.#pumpThumbnails();
  }

  #pumpThumbnails(): void {
    const thumbs = this.#ports.thumbnails ?? nullThumbnails;
    while (!this.#disposed && this.#thumbRunning < THUMBNAIL_JOBS && this.#thumbQueue.length) {
      const entry = this.#thumbQueue.shift()!;
      this.#thumbRunning++;
      void thumbs
        .make(entry.path)
        .catch(() => undefined)
        .then((url) => {
          this.#thumbRunning--;
          if (url && !this.#disposed && this.#listing.includes(entry)) {
            entry.thumb = url;
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

  /** Start a Library video full screen. Resume (ticket 008) hooks in here via `startSeconds`. */
  #play(path: string): void {
    if (this.#mpvMissing) return this.#toast(MPV_MISSING);
    this.#state.player = { path, pos: 0, dur: 0, paused: false };
    this.#state.view = "player";
    this.#showOverlay();
    this.#ports.player
      .load(path, { subtitles: this.#state.subtitlesOn })
      .catch(() => this.#endPlayback("Couldn't play this video"));
  }

  /** Leave playback for a view. Ticket 008 saves the position here (state.player still set). */
  #endPlayback(toast?: string): void {
    if (!this.#state.player) return;
    this.#state.player = undefined;
    this.#overlayShown = false;
    this.#cancelOverlay?.();
    this.#state.view = this.#state.folderPath ? "folder" : "library";
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
      case "ended":
        // Our own stops report "stop"; only a natural end or a failure leaves playback.
        if (event.reason === "eof") this.#endPlayback();
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

  /** What mpv should draw over the video right now. */
  #overlay(): PlayerOverlay | undefined {
    const p = this.#state.player;
    if (!p) return undefined;
    return {
      title: cleanTitle(basename(p.path)),
      bar: this.#overlayShown ? { position: p.pos, duration: p.dur } : undefined,
      paused: p.paused,
      volume: this.#state.volumeShown ? this.#state.volume : undefined,
    };
  }

  #saveFolders(folders: string[]): void {
    this.#libraryFolders = folders;
    this.#ports.store.write("library", { folders });
  }

  /** Everything the Screen renderer needs to draw. */
  screen(): ScreenPayload {
    const grid = this.#currentGrid();
    const focused = resolveFocus(grid, this.#state.focus[this.viewKey]);
    return {
      library: this.#library(),
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
    if (from !== "screen") this.#lastFrom = from;
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

  dispose(): void {
    this.#disposed = true;
    this.#cancelToast?.();
    this.#cancelMinute?.();
    this.#cancelOverlay?.();
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

  #ok(): void {
    if (this.#state.view === "youtube") return this.#ports.youtube.sendKey("ok");
    const grid = this.#currentGrid();
    const item = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!item) return;
    if (item.action === "back") return this.#back();
    if (this.#libraryAction(item.action)) return;
    const action = ACTIONS[item.action];
    // Placeholder tiles until the Apps exist.
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
      if (this.#libraryFolders.includes(path)) this.#state.view = "library";
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
      this.#ports.mac.keepDisplayAwake(false);
    }
    this.#state.view = view;
  }

  #openYouTube(): void {
    if (this.#ytFailed) {
      this.#setView("youtubeError");
      return;
    }
    this.#setView("youtube");
    this.#ports.mac.keepDisplayAwake(true);
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
        }
        break;
      default:
        return;
    }
    this.#emit();
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
      quit: () => this.#ports.mac.quit(),
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
    const overlay = this.#overlay();
    const key = JSON.stringify(overlay ?? null);
    if (key !== this.#lastOverlay) {
      this.#lastOverlay = key;
      this.#ports.player.setOverlay(overlay);
    }
    for (const l of [...this.#listeners]) l();
  }
}
