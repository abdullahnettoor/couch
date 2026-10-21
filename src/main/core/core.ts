import { existsSync } from "node:fs";
import { safeEqual } from "../constant-time.ts";
import { liveListener, systemProbe, type ListenerProbe } from "../listener.ts";
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
  type Confirmation,
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
import type { App, AppEvent, AppTyping } from "../apps/app.ts";
import { randomBytes } from "node:crypto";
import type { Store } from "../ports/store.ts";
import type { Thumbnails } from "../ports/thumbnails.ts";
import { ThumbnailScheduler } from "./thumbnail-scheduler.ts";
import { actionFor, BACK_TARGETS, type ActionContext } from "./actions.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import { MediaLibrary } from "./media-library.ts";
import { artFor, type PathArt } from "./art.ts";
import { libraryRows, tileAction, topGenres } from "./library-rows.ts";
import { autoRows, chipsFor, keepFor } from "./library-chips.ts";
import { presentation, hueFor, listFolder, mosaicSources, rootEntries } from "./library.ts";
import { applyEdit, type TextEdit } from "../../shared/keyboard.ts";
import type { LibraryChip, UpNextItem } from "../../shared/protocol.ts";
import { PlayerControls } from "./player-controls.ts";
import { History } from "./history.ts";
import { ShowView } from "./show-view.ts";
import { AddonsPage } from "./addons-page.ts";
import { DetailsPage } from "./details-page.ts";
import { SoundOutput } from "./sound-output.ts";
import { LibrarySearchView } from "./library-search-view.ts";
import { AMBIENT_MS, filmAfterFocus, homeGrid } from "./home-view.ts";
import type { TimeFormat } from "../../shared/clock-format.ts";
import { MetadataService } from "./metadata-service.ts";
import { nullMetadata, type Metadata } from "../ports/metadata.ts";

/** In-progress videos shown on Home. */
const HOME_VIDEOS = 3;
const TILE_COLUMNS = 4;
const LIBRARY_VIEWS = ["library", "folder", "libraryFolders"];
/** Views where a phone's Search button opens the Library search. */
const TYPING_VIEW = { search: "app", tmdbKey: "details", librarySearch: "librarySearch" };
type Purpose = keyof typeof TYPING_VIEW;
const SCREEN_ONLY = ["focusAt", "showControls", "find", "screenKey"];
const NAV = ["up", "down", "left", "right"];
/** Views the Library search's query and focus survive, so Back returns to them. */
const SEARCH_KEEPS: View[] = ["librarySearch", "show", "fixMatch", "player"];
const SEARCH_FROM: View[] = ["library", "folder", "show", "librarySearch"];

export interface Ports {
  player: Player;
  /** The web Apps Home can open (see `apps/index.ts` for their entries). */
  apps: App[];
  mac: Mac;
  clock: Clock;
  store: Store;
  thumbnails?: Thumbnails;
  /** Show and film details (TMDB). Without it, everything uses frames. */
  metadata?: Metadata;
  /** The project's TMDB key, built into release builds; used when the household has none of its own. */
  tmdbProjectKey?: string;
  /** A live listener (the always-on front door): its public port goes in the QR code and it handles `power`. */
  listener?: { publicPort: number; token: string };
  /** How the listener is told apart from "not there" right now (the real system when absent). */
  listenerProbe?: ListenerProbe;
  /** Moves the Remote server out of the listener's way and back when the login item is toggled while Couch runs. */
  frontdoor?: {
    beforeEnable(): Promise<void>;
    afterChange(on: boolean): Promise<void>;
  };
}

/** Who sent a command: a connected phone, or the Screen's own keyboard. */
export type Source = RemoteId | "screen";

const TOAST_MS = 3000;
const IDLE_DISPLAY_MS = 30 * 60_000;
const OVERLAY_MS = 3000;
const SAVE_EVERY_MS = 5000;
const MPV_MISSING = "Couch needs mpv to play videos. Install it with: brew install mpv";
const VOLUME_STEP = 5;
const APP_NOTE = "Press Home on your phone to come back";

/** The single source of truth: holds the Screen state and turns commands into new state. */

export class Core {
  #ports: Ports;
  #state: ScreenState = {
    view: "home",
    focus: {},
    query: "",
    subtitlesOn: true,
    controls: "hidden",
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
  #listener: { publicPort: number; token: string } | undefined;
  #forgetListeners = new Set<() => void>();
  #apps = new Map<string, App>();
  /** Apps that failed to load and have not loaded since. */
  #appsFailed = new Set<string>();
  #lastFrom: RemoteId | undefined;
  /** What each App was last told to draw over itself. */
  #shown = new Map<string, { volume?: number; confirm?: Confirmation; bar?: string }>();
  #confirmAnswers: [() => void, () => void] | undefined;
  /** The question core asked on behalf of an App's Back ("Leave <label>?"). */
  #leaveConfirm: Confirmation | undefined;
  #appsOff: Array<() => void> = [];
  #libraryFolders: string[];
  /** The open folder's contents, read fresh each time it is opened. */
  #listing: LibraryEntry[] = [];
  /** Where the playing video was started from; leaving playback returns there. */
  #playedFrom: View = "folder";
  #mpvMissing = false;
  #cancelVolume: (() => void) | undefined;
  #subtitlesRaised = "falsefalse";
  #unsubPlayer: () => void;
  #thumbs: ThumbnailScheduler;
  #mosaics = new Map<string, { sources: string[]; count: number }>();
  #rootKey: string | undefined;
  #controls: PlayerControls;
  #history: History;
  /** The Library index and its Shows and Films; scans run in the background. */
  readonly library: MediaLibrary;
  /** TMDB details for Shows and Films (saved matches, Fix match, key settings). */
  readonly details: MetadataService;
  #show: ShowView;
  #detailsPage: DetailsPage;
  #addonsPage: AddonsPage;
  #sound: SoundOutput;
  #search: LibrarySearchView;
  /** Where Back from a show page goes: the Library, or the search it was opened from. */
  /** The active filter chip on the Library's first page (a chip key), if any. */
  #chip: string | undefined;
  #showFrom: "library" | "librarySearch" = "library";
  #dataVersion = 0;
  /** What the phone currently typing is typing into. */
  #typingFor: Purpose | undefined;
  /** Who sent the command being handled. */
  #source: Source = "screen";
  #capturing: AppTyping | undefined;
  #cancelSaves: (() => void) | undefined;
  #resumeNote: string | undefined;
  #cancelNote: (() => void) | undefined;
  #displayId: number | undefined;
  #unsubDisplays: () => void;
  #idle = false;
  #cancelIdle: (() => void) | undefined;
  #displayAwake: boolean | undefined;

  constructor(ports: Ports) {
    this.#ports = ports;
    const lib = ports.store.read<{ folders?: unknown }>("library", {});
    this.#history = new History(ports.store);
    this.library = new MediaLibrary(ports.store, ports.clock);
    this.details = new MetadataService({
      store: ports.store,
      clock: ports.clock,
      port: ports.metadata ?? nullMetadata,
      library: this.library,
      projectKey: ports.tmdbProjectKey,
      changed: () => {
        this.#dataVersion++;
        this.#emit();
      },
    });
    this.library.onChange(() => {
      this.#dataVersion++;
      this.details.sync();
      this.#keepLibraryFocus();
      this.#emit();
    });
    this.details.sync();
    this.#listener = ports.listener;
    void this.refreshLoginItem();
    this.#controls = new PlayerControls(this.#state, {
      clock: ports.clock,
      playing: () => {
        const p = this.#state.player;
        return p && { path: p.path, position: p.pos, paused: p.paused };
      },
      seekTo: (seconds) => this.#seekTo(seconds),
      togglePause: () => this.#togglePause(),
      toggleSubtitles: () => this.#toggleSubtitles(),
      setVolume: (percent) => this.#setVolume(percent),
      play: (path) => this.#play(path),
      leave: () => this.#endPlayback(undefined, true),
      changed: () => this.#emit(),
    });
    this.#thumbs = new ThumbnailScheduler(ports.thumbnails, () => this.#emit());
    this.#show = new ShowView(this.#state, {
      library: this.library,
      history: this.#history,
      details: this.details,
      thumbs: this.#thumbs,
      art: (path) => this.#art(path),
      grid: () => this.#currentGrid(),
      viewKey: () => this.viewKey,
      focusedEntry: () => {
        const focused = resolveFocus(this.#currentGrid(), this.#state.focus[this.viewKey]);
        return this.#rows()
          .rows.flatMap((r) => r.entries)
          .find((e) => (e.id ?? e.path) === focused?.id);
      },
      play: (path, fromStart) => this.#play(path, fromStart),
      setView: (view) => this.#setView(view),
      toast: (text) => this.#toast(text),
      changed: () => this.#emit(),
    });
    this.#sound = new SoundOutput({
      store: ports.store,
      mac: ports.mac,
      player: ports.player,
      sinks: ports.apps,
      toast: (text) => this.#toast(text),
      changed: () => this.#emit(),
    });
    this.#state.volume = this.#sound.volume;
    this.#addonsPage = new AddonsPage({
      store: ports.store,
      apply: (app, ids, note) => this.#apps.get(app)?.setAddons?.(ids, note),
      isFront: (app) => this.#front()?.id === app,
      toast: (text) => this.#toast(text),
      changed: () => this.#emit(),
    });
    this.#detailsPage = new DetailsPage(this.#state, {
      details: this.details,
      connectedPhone: () =>
        this.#lastFrom !== undefined && this.#remotes.has(this.#lastFrom)
          ? this.#lastFrom
          : undefined,
      startTyping: (remote) => {
        this.#state.typingBy = remote;
        this.#typingFor = "tmdbKey";
      },
      setView: (view) => this.#setView(view),
      toast: (text) => this.#toast(text),
    });
    this.#search = new LibrarySearchView(this.#state, {
      library: this.library,
      history: this.#history,
      details: (id) => this.details.detailsFor(id),
      dataVersion: () => this.#dataVersion,
      thumbs: this.#thumbs,
      clock: ports.clock,
      changed: () => this.#emit(),
      decorate: (e) => this.#decorate(e),
      startTyping: (remote) => {
        this.#state.typingBy = remote;
        this.#typingFor = "librarySearch";
      },
      connectedPhone: () =>
        this.#lastFrom !== undefined && this.#remotes.has(this.#lastFrom)
          ? this.#lastFrom
          : undefined,
      setView: (view) => this.#setView(view),
      toast: (text) => this.#toast(text),
    });
    this.#libraryFolders = Array.isArray(lib.folders)
      ? lib.folders.filter((f): f is string => typeof f === "string")
      : [];
    void this.library.refresh(this.#libraryFolders);
    const saved = ports.store.read<{ key?: string }>("pairing", {});
    this.#key = typeof saved.key === "string" && saved.key ? saved.key : this.#newKey();
    const playback = ports.store.read<{ subtitlesOn?: unknown }>("playback", {});
    this.#state.subtitlesOn = playback.subtitlesOn !== false;
    this.#unsubPlayer = ports.player.onEvent((event) => this.#onPlayerEvent(event));
    this.#timeFormat = ports.mac.timeFormat();
    this.#offTimeFormat = ports.mac.onTimeFormatChanged(() => this.#readTimeFormat());
    this.#scheduleMinute();
    this.#displayId = pickTargetDisplay(ports.mac.listDisplays())?.id;
    this.#unsubDisplays = ports.mac.onDisplaysChanged(() => this.#retarget());
    this.#armIdle();
    this.#armAmbient();
    this.#syncDisplayAwake();
    for (const app of ports.apps) {
      this.#apps.set(app.id, app);
      this.#appsOff.push(app.onEvent((event) => this.#onApp(app, event)));
    }
  }

  /** The App the Screen is showing, if any. */
  #front(): App | undefined {
    return this.#state.view === "app" ? this.#apps.get(this.#state.app ?? "") : undefined;
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

  /** The listener Couch now sits behind (or none), which decides the port in the QR code. */
  setListener(listener: { publicPort: number; token: string } | undefined): void {
    this.#listener = listener;
  }

  acceptsKey(key: string | null | undefined): boolean {
    return typeof key === "string" && key.length > 0 && safeEqual(key, this.#key);
  }

  get pairingUrl(): string {
    const port = this.#listener?.publicPort ?? this.#port;
    return `http://${this.#ports.mac.localName()}:${port}/?key=${this.#key}`;
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
  #library(focusedId?: string): LibraryPayload | undefined {
    switch (this.#state.view) {
      case "library": {
        const rows = this.#rows().rows;
        const folders = this.#chip ? [] : rootEntries(this.#libraryFolders);
        const ids = [...rows.flatMap((r) => r.entries), ...folders].map((e) => e.id ?? e.path);
        if (focusedId && ids.includes(focusedId)) this.#lastTile = focusedId;
        else if (this.#lastTile && !ids.includes(this.#lastTile)) this.#lastTile = undefined;
        const featuredId = this.#lastTile ?? ids[0];
        return {
          heading: "Library",
          entries: this.#chip
            ? []
            : rootEntries(this.#libraryFolders).map((e) => ({
                ...this.#withMosaic(e),
                feature: { kind: "Folder" as const, title: e.title },
              })),
          continueWatching: this.#continueEntries(),
          rows,
          chips: this.#chips(),
          ...(featuredId ? { featuredId } : {}),
          emptyText: "No folders yet. Add one in Settings on the Mac.",
        };
      }
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

  /** The tile focused on the Library's first page, so rows that change under it don't move focus. */
  #rootFocusId: string | undefined;
  /** Home: the film card whose backdrop shows (focused, or last focused while Resume / From start has focus). */
  #homeFilm: string | undefined;
  #ambient = false;
  #cancelAmbient: (() => void) | undefined;
  #timeFormat: TimeFormat = "12";
  #offTimeFormat: (() => void) | undefined;
  /** The last tile focused on the Library's first page; the featured area keeps showing it while a chip or icon has focus. */
  #lastTile: string | undefined;

  #keepLibraryFocus(): void {
    if (this.#state.view !== "library" || !this.#rootFocusId) return;
    const at = this.#currentGrid().find((i) => i.id === this.#rootFocusId);
    if (at) this.#state.focus[this.viewKey] = { r: at.r, c: at.c };
  }

  /** The chip row; an active chip that no longer exists is dropped. */
  #chips(): LibraryChip[] {
    const make = () =>
      chipsFor({
        details: this.details,
        shows: this.library.shows().length,
        films: this.library.films().length,
        active: this.#chip,
      });
    let chips = make();
    if (this.#chip && !chips.some((c) => c.key === this.#chip)) {
      this.#chip = undefined;
      chips = make();
    }
    return chips;
  }

  #rows(): ReturnType<typeof libraryRows> {
    const chips = this.#chips();
    return libraryRows({
      ...(this.#chip && chips.length
        ? { keep: keepFor(this.#chip, this.details) }
        : this.#state.view === "library"
          ? { auto: autoRows(this.details) }
          : {}),
      library: this.library,
      history: this.#history,
      decorate: (e) => this.#decorate(e),
      continueEntries: this.#continueEntries(),
      thumb: (p) => this.#thumbs.urlFor(p),
      details: (id) => this.details.detailsFor(id),
    });
  }

  /** TMDB details for a video path (its show or film, and the episode's own name, overview and still). */
  #art(path: string): PathArt {
    return artFor(this.library, (id) => this.details.detailsFor(id), path);
  }

  /** The episode's still, else a film's backdrop, else a frame from the video. */
  #still(path: string, frame: (p: string) => string | undefined): string | undefined {
    const { details, episode } = this.#art(path);
    return episode?.still ?? details?.backdrop ?? frame(path);
  }

  /** Overlay title and line for a video: the TMDB episode name replaces the parsed one. */
  #present(path: string): { title: string; line?: string } {
    const p = presentation(path);
    const name = this.#art(path).episode?.name;
    return name ? { ...p, title: name } : p;
  }

  #nowGenres(path: string): { genres?: string } {
    const genres = topGenres(this.#art(path).details);
    return genres.length ? { genres: genres.join(" · ") } : {};
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
      const thumb = this.#thumbs.urlFor(entry.path);
      return thumb ? { ...entry, thumb } : entry;
    }
    const m = this.#mosaics.get(entry.path);
    if (!m || entry.missing) return entry;
    const mosaic = m.sources.flatMap((p) => this.#thumbs.urlFor(p) ?? []);
    return { ...entry, count: m.count, ...(mosaic.length ? { mosaic } : {}) };
  }

  /** On arriving at the Library's first page, finds each folder's mosaic sources and queues their pictures. */
  #syncRoot(): void {
    if (this.#state.view !== "library") {
      this.#rootKey = undefined;
      return;
    }
    const rows = this.#rows();
    const key = [...this.#libraryFolders, "", ...rows.wanted].join("\0");
    if (this.#rootKey === key) return;
    this.#rootKey = key;
    this.#mosaics.clear();
    const paths: string[] = [...rows.wanted];
    for (const f of this.#libraryFolders) {
      if (!existsSync(f)) continue;
      const m = mosaicSources(f);
      this.#mosaics.set(f, m);
      paths.push(...m.sources);
    }
    this.#thumbs.want(paths);
  }

  #continueEntries(): LibraryEntry[] {
    return this.#history.continueWatching().map((c) => {
      const { title, line } = presentation(c.path);
      const { details, episode } = this.#art(c.path);
      const thumb = this.#still(c.path, (p) => this.#thumbs.lookup(p));
      return this.#decorate({
        kind: "video",
        path: c.path,
        title: episode?.name ?? title,
        ...(line ? { line } : {}),
        hue: hueFor(title),
        folder: basename(dirname(c.path)),
        thumb,
        ...(details?.backdrop ? { backdrop: details.backdrop } : {}),
        ...(details?.genres?.length ? { genres: topGenres(details) } : {}),
        ...((episode?.overview ?? details?.overview)
          ? { overview: episode?.overview ?? details?.overview }
          : {}),
      });
    });
  }

  #currentGrid(): GridItem[] {
    if (this.#state.view === "home") {
      const base = this.#grids.get("home") ?? [];
      const videos = base.length ? this.#continueEntries().slice(0, HOME_VIDEOS) : [];
      const gridFor = () =>
        homeGrid(
          base,
          videos,
          videos.find((v) => v.path === this.#homeFilm),
        );
      let grid = gridFor();
      this.#homeFilm = filmAfterFocus(
        resolveFocus(grid, this.#state.focus.home)?.id,
        videos,
        this.#homeFilm,
      );
      grid = gridFor();
      return grid;
    }
    if (this.#state.view === "player") return this.#controls.grid();
    if (this.#state.view === "details") return this.#detailsPage.grid();
    if (this.#state.view === "soundOutput") return this.#sound.grid();
    if (this.#state.view === "addons") return this.#addonsPage.grid();
    if (this.#state.view === "show") return this.#show.grid();
    if (this.#state.view === "fixMatch") return this.#show.fixGrid();
    if (this.#state.view === "librarySearch") return this.#search.grid();
    if (this.#state.view === "credits")
      return [{ id: "done", r: 0, c: 0, label: "Done", action: "back", initial: true }];
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
    const tile = (e: LibraryEntry, r: number, c: number, initial: boolean): GridItem => ({
      id: e.id ?? e.path,
      r,
      c,
      label: e.title,
      action: tileAction(e),
      initial,
    });
    // Row 0 is the top strip's gear, as on Home; the chips are row 1 when there are any; each page row is one grid row, Folders wrap below.
    const rows = lib.rows ?? [];
    const chips = lib.chips ?? [];
    const top = chips.length ? 2 : 1;
    const chipItems: GridItem[] = chips.map((c, i) => ({
      id: `chip:${c.key}`,
      r: 1,
      c: i,
      label: c.label,
      action: `library:chip:${c.key}`,
    }));
    const tiles = [
      ...rows.flatMap((row, r) =>
        row.entries.map((e, c) => tile(e, top + r, c, r === 0 && c === 0)),
      ),
      ...lib.entries.map((e, i) =>
        tile(
          e,
          top + rows.length + Math.floor(i / TILE_COLUMNS),
          i % TILE_COLUMNS,
          rows.length === 0 && i === 0,
        ),
      ),
    ];
    const gear: GridItem = {
      id: "settings",
      r: 0,
      c: 0,
      label: "Settings",
      action: "open:settings",
      initial: tiles.length === 0,
    };
    const search: GridItem = {
      id: "search",
      r: 0,
      c: -1,
      label: "Search",
      action: "library:search",
    };
    return [search, gear, ...chipItems, ...tiles];
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
    this.#thumbs.want(paths);
    this.#state.folderPath = path;
    this.#state.view = "folder";
  }

  #libraryAction(action: string): boolean {
    if (!action.startsWith("library:")) return false;
    const [, verb, ...rest] = action.split(":");
    const arg = rest.join(":");
    if (verb === "missing") this.#toast("Connect the drive to see this folder");
    else if (verb === "open") this.#openFolder(arg);
    else if (verb === "play") this.#play(arg);
    else if (verb === "playstart") this.#play(arg, true);
    else if (verb === "search") {
      this.#search.open();
      if (this.#source === "screen") this.#search.action("search:field", "screen");
    } else if (verb === "chip") {
      this.#chip = this.#chip === arg || arg === "all" ? undefined : arg;
      this.#lastTile = undefined;
    } else if (verb === "show") {
      this.#showFrom = this.#state.view === "librarySearch" ? "librarySearch" : "library";
      this.#show.open(arg);
    } else if (verb === "remove") this.#saveFolders(this.#libraryFolders.filter((f) => f !== arg));
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
  #play(path: string, fromStart = false): void {
    if (this.#mpvMissing) return this.#toast(MPV_MISSING);
    // Continue watching (Home or the Library row) returns there, not into the video's folder.
    const switching = this.#state.view === "player";
    if (switching) this.savePlayingPosition();
    else this.#playedFrom = this.#state.view === "folder" ? "folder" : this.#state.view;
    if (this.#playedFrom === "folder") this.#focusEntry(path);
    const show = this.library.showOf(path);
    const upNext: LibraryEntry[] = show
      ? show.seasons.flatMap((se) =>
          se.episodes.map((e): LibraryEntry => ({
            kind: "video",
            path: e.path,
            title: presentation(e.path).title,
            hue: hueFor(presentation(e.path).title),
          })),
        )
      : (listFolder(dirname(path)) ?? []).filter((e) => e.kind === "video");
    this.#upNextLabel = show?.name;
    const startSeconds = fromStart ? undefined : this.#history.resumeAt(path);
    this.#state.player = { path, pos: startSeconds ?? 0, dur: 0, paused: false };
    this.#state.view = "player";
    this.#controls.begin(upNext);
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
      r: 1 + Math.floor(index / TILE_COLUMNS),
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
    this.#controls.end();
    if (this.#playedFrom === "folder") {
      this.#focusEntry(p.path, ended);
      this.#state.view = this.#state.folderPath ? "folder" : "library";
    } else if (this.#playedFrom === "show" && this.#state.showId) {
      this.#show.returnTo(p.path, ended);
    } else {
      this.#state.view = this.#playedFrom === "show" ? "library" : this.#playedFrom;
      if (this.#state.view === "home") this.#focusHomeCard(p.path);
    }
    if (toast) this.#toast(toast);
    this.#keepLibraryFocus();
    this.#emit();
  }

  /** Back on Home after a video started there: focus returns to its card, so its backdrop shows. */
  #focusHomeCard(path: string): void {
    const base = this.#grids.get("home") ?? [];
    const videos = this.#continueEntries().slice(0, HOME_VIDEOS);
    const film = videos.find((v) => v.path === path);
    const card = homeGrid(base, videos, film).find((i) => i.id === path);
    this.#homeFilm = card ? path : undefined;
    if (card) this.#state.focus.home = { r: card.r, c: card.c };
    else delete this.#state.focus.home;
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
        if (event.reason === "eof") this.#ended();
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
          this.#controls.show();
          this.#emit();
        }
        break;
    }
  }

  /** The video played to its end: offer the next one in its folder, or leave. */
  #ended(): void {
    const p = this.#state.player;
    if (!p || !this.#controls.offerNext()) return this.#endPlayback(undefined, true);
    this.#cancelSaves?.();
    this.#cancelSaves = undefined;
    if (p.dur > 0) p.pos = p.dur;
    this.#history.save(p.path, p.pos, p.dur, this.#ports.clock.now(), true);
    this.#emit();
  }

  #quiet(promise: Promise<void>): void {
    void promise.catch(() => {});
  }

  #seekTo(seconds: number): void {
    const p = this.#state.player!;
    const max = p.dur > 0 ? p.dur : Infinity;
    p.pos = Math.min(max, Math.max(0, seconds));
    this.#quiet(this.#ports.player.seekTo(p.pos));
  }

  #togglePause(): void {
    const p = this.#state.player!;
    p.paused = !p.paused;
    this.#quiet(this.#ports.player.setPaused(p.paused));
  }

  #toggleSubtitles(): void {
    this.#state.subtitlesOn = !this.#state.subtitlesOn;
    this.#ports.store.write("playback", { subtitlesOn: this.#state.subtitlesOn });
    this.#quiet(this.#ports.player.setSubtitles(this.#state.subtitlesOn));
  }

  /** Commands while a video plays. Returns false for the ones handled like anywhere else. */
  #playbackCommand(command: Command): boolean {
    const p = this.#state.player!;
    const name = command.command;
    if (this.#state.controls === "next") {
      if (name === "playNext") this.#controls.playNext();
      else if (name === "back" || name === "home") {
        this.#endPlayback(undefined, true);
        if (name === "home") this.#setView("home");
      } else return this.#controls.command(command);
      return true;
    }
    if (name === "playNext") return true;
    if (name === "playUpNext") {
      this.#controls.playUpNext(command.args?.index);
      return true;
    }
    if (name === "back" && this.#controls.back()) return true;
    if (name === "back" || name === "home") {
      this.#stopPlayback();
      this.#endPlayback();
      if (name === "home") this.#setView("home");
      return true;
    }
    if (name === "playpause" || name === "seekBy" || name === "seekTo" || name === "subtitles")
      this.#controls.show();
    switch (name) {
      case "playpause":
        this.#togglePause();
        return true;
      case "seekBy":
        this.#seekTo(p.pos + (command.args?.seconds ?? 0));
        return true;
      case "seekTo":
        this.#seekTo(command.args?.seconds ?? 0);
        return true;
      case "subtitles":
        this.#toggleSubtitles();
        return true;
      default:
        return this.#controls.command(command);
    }
  }

  /** What the renderer should draw over the video right now. */
  #overlay(): PlayerOverlay | undefined {
    const p = this.#state.player;
    if (!p) return undefined;
    return {
      ...this.#present(p.path),
      controls: this.#state.controls,
      dock:
        this.#state.controls !== "hidden" && this.#state.controls !== "next"
          ? {
              position: p.pos,
              duration: p.dur,
              subtitlesOn: this.#state.subtitlesOn,
              level: this.#state.volume,
              focusedId: this.#controls.focusedDock(),
              upNext: this.#controls.upNextAvailable,
            }
          : undefined,
      upNext: this.#state.controls === "upnext" ? this.#upNextTiles() : undefined,
      next: this.#nextCard(),
      paused: p.paused,
      note: this.#resumeNote,
      volume: this.#state.volumeShown ? this.#state.volume : undefined,
    };
  }

  #nextCard(): PlayerOverlay["next"] {
    const next = this.#controls.next;
    if (!next || this.#state.controls !== "next") return undefined;
    const { title, line } = this.#present(next.path);
    return {
      title,
      ...(line ? { line } : {}),
      thumb: this.#still(next.path, (p) => this.#thumbs.lookup(p)),
      hue: hueFor(title),
      focusedId: this.#controls.focusedCard(),
    };
  }

  /** The show's name while its episodes are the Up next list. */
  #upNextLabel: string | undefined;

  #upNextTiles(): NonNullable<PlayerOverlay["upNext"]> {
    const playing = this.#state.player?.path;
    const tiles = this.#controls.upNext.map((e) => {
      const d = this.#decorate({ ...e });
      const { title, line } = this.#present(e.path);
      return {
        title,
        ...(line ? { line } : {}),
        thumb: this.#still(e.path, (p) => this.#thumbs.lookup(p)),
        hue: hueFor(title),
        watched: d.watched === true,
        playing: e.path === playing,
        progress: d.progress?.fraction,
      };
    });
    return {
      tiles,
      folder: this.#upNextLabel ?? basename(dirname(playing ?? "")),
      focusedIndex: this.#controls.focusedTile,
    };
  }

  /** The phone fetches pictures by key: a frame's, or a cached TMDB still or poster's. */
  #thumbKey(path: string): string | undefined {
    const { details, episode } = this.#art(path);
    return (episode?.still ?? details?.poster ?? this.#thumbs.urlFor(path))
      ?.split("/")
      .pop()
      ?.replace(/\.jpg$/, "");
  }

  #upNextItems(): UpNextItem[] {
    const playing = this.#state.player?.path;
    return this.#controls.upNext.map((e) => {
      const key = this.#thumbKey(e.path);
      const progress = this.#history.progress(e.path);
      return {
        ...this.#present(e.path),
        ...(key ? { thumbKey: key } : {}),
        watched: this.#history.isWatched(e.path),
        playing: e.path === playing,
        ...(progress ? { progress: progress.position / progress.duration } : {}),
      };
    });
  }

  #saveFolders(folders: string[]): void {
    this.#libraryFolders = folders;
    void this.library.refresh(folders);
    this.#ports.store.write("library", { folders });
  }

  /** Everything the Screen renderer needs to draw. */
  screen(): ScreenPayload {
    this.#syncRoot();
    const grid = this.#currentGrid();
    const focused = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (this.#state.view === "library") this.#rootFocusId = focused?.id;
    const homeVideos = this.#continueEntries().slice(0, HOME_VIDEOS);
    return {
      library: this.#library(focused?.id),
      ...(this.#state.view === "show" ? this.#show.payload() : {}),
      ...(this.#state.view === "fixMatch" ? this.#show.fixPayload() : {}),
      ...(this.#state.view === "librarySearch" ? this.#search.payload() : {}),
      ...(this.#state.view === "details" ||
      this.#state.view === "settings" ||
      this.#state.view === "credits"
        ? { details: this.details.settings() }
        : {}),
      ...(this.#state.view === "settings" || this.#state.view === "soundOutput"
        ? { sound: this.#sound.payload() }
        : {}),
      ...(this.#state.view === "settings" || this.#state.view === "addons"
        ? { addons: this.#addonsPage.payload() }
        : {}),
      ...(this.#state.view === "settings" ? { listener: { ...this.#loginItem } } : {}),
      continueCard: this.#continueEntries()[0],
      homeVideos,
      hero:
        this.#state.view === "home" ? homeVideos.find((v) => v.path === this.#homeFilm) : undefined,
      ambient: this.#ambient,
      timeFormat: this.#timeFormat,
      overlay: this.#overlay(),
      ...(this.#state.typingBy === "screen" && this.#typingFor
        ? { screenTyping: this.#typingFor }
        : {}),
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
    const card = s.view === "home" ? this.#continueEntries()[0] : undefined;
    const searchable = SEARCH_FROM.includes(s.view);
    const front = this.#front();
    const searching = s.typingBy === remote && this.#typingFor === "librarySearch";
    return {
      type: "snapshot",
      where:
        s.view === "library" && this.#chip
          ? `Library · ${this.#chips().find((c) => c.active)?.label ?? ""}`
          : s.view === "folder"
            ? basename(s.folderPath ?? "")
            : s.view === "show"
              ? (this.library.show(s.showId ?? "")?.name ?? VIEW_LABELS.show)
              : s.view === "app" || s.view === "appError"
                ? (this.#apps.get(s.app ?? "")?.label ?? VIEW_LABELS[s.view])
                : VIEW_LABELS[s.view],
      view: s.view,
      layout:
        s.view === "app"
          ? (front?.layout ?? "app")
          : s.view === "home" || s.view === "player" || s.view === "librarySearch"
            ? s.view
            : "other",
      ...(card
        ? {
            continueCard: {
              title: card.title,
              left: card.progress?.left ?? "",
              ...(this.#thumbKey(card.path) ? { thumbKey: this.#thumbKey(card.path) } : {}),
            },
          }
        : {}),
      ...(s.controls === "next" && this.#controls.next
        ? {
            next: {
              ...this.#present(this.#controls.next.path),
              ...(this.#thumbKey(this.#controls.next.path)
                ? { thumbKey: this.#thumbKey(this.#controls.next.path) }
                : {}),
            },
          }
        : {}),
      ...(s.confirm ? { confirm: s.confirm } : {}),
      typeAvailable: (s.view === "app" && !!front?.typing) || s.view === "details" || searchable,
      ...(this.#show.fixTarget() ? { fixAvailable: true } : {}),
      ...(s.view === "details" ? { typeLabel: "Type TMDB key" } : {}),
      ...(searchable ? { typeLabel: "Search Library" } : {}),
      ...(front?.typing ? { typeLabel: front.typing.label } : {}),
      ...(searching
        ? { typePlaceholder: "Search your Library", typeSeed: this.#search.query }
        : {}),
      showVolume: front?.showVolume ?? false,
      showSkip: front?.showSkip ?? false,
      typing:
        s.typingBy === undefined
          ? "none"
          : s.typingBy === remote
            ? "you"
            : s.typingBy === "screen"
              ? "screen"
              : "other",
      nowPlaying: s.player && {
        ...this.#present(s.player.path),
        folder: basename(dirname(s.player.path)),
        position: s.player.pos,
        duration: s.player.dur,
        paused: s.player.paused,
        subtitlesOn: s.subtitlesOn,
        ...this.#nowGenres(s.player.path),
      },
      ...(s.player && this.#controls.upNextAvailable ? { upNext: this.#upNextItems() } : {}),
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
    if (SCREEN_ONLY.includes(command.command) && from !== "screen") return;
    this.#source = from;
    if (from !== "screen") this.#lastFrom = from;
    this.#ports.mac.wakeDisplay();
    this.#armIdle();
    if (this.#ambient) {
      this.#ambient = false;
      this.#armAmbient();
      this.#emit();
      return;
    }
    this.#armAmbient();
    if (command.command === "showControls" && !this.#state.player) return;
    if (this.#confirmCommand(command)) return;
    if (command.command === "focusAt") return this.#focusAt(command.args?.r, command.args?.c);
    if (this.#typingKeys(command, from)) return;
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
        if (from === "screen") this.#fieldReached();
        break;
      case "ok":
        this.#ok();
        break;
      case "back":
        this.#back();
        break;
      case "menu":
        this.#show.menu();
        break;
      case "find":
        this.#find();
        break;
      case "screenKey":
        this.#screenKey(command.args?.text);
        break;
      case "home":
        this.#setView("home");
        break;
      case "power":
        if (!this.#listener) this.quit();
        break;
      case "resume": {
        const newest = this.#continueEntries()[0];
        if (!newest) break;
        this.#setView("home");
        this.#play(newest.path);
        break;
      }
      case "playpause":
        this.#front()?.playPause?.();
        break;
      case "seekBy":
        this.#front()?.seekBy?.(command.args?.seconds ?? 0);
        break;
      case "volUp":
      case "volDown":
        this.#setVolume(
          this.#state.volume + (command.command === "volUp" ? VOLUME_STEP : -VOLUME_STEP),
        );
        break;
      case "toggleAddon":
        this.#addonsPage.toggle(command.args?.addon ?? "");
        break;
      case "volSet":
        this.#setVolume(command.args?.percent ?? this.#state.volume);
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

  /** What a typing session started now would be typing into: decided by the view it opens in. */
  #purposeFor(view: View): Purpose | undefined {
    if (view === "app") return this.#front()?.typing ? "search" : undefined;
    if (view === "details") return "tmdbKey";
    return SEARCH_FROM.includes(view) ? "librarySearch" : undefined;
  }

  #endTyping(): void {
    if (this.#state.typingBy === undefined) return;
    if (this.#typingFor === "tmdbKey") this.#detailsPage.cancel();
    this.#state.typingBy = undefined;
    this.#typingFor = undefined;
  }

  /** ⌘F on the Screen: type a search wherever one can be typed. */
  #find(): void {
    const view = this.#state.view;
    if (this.#purposeFor(view) === "tmdbKey" || this.#state.typingBy === "screen") return;
    if (this.#purposeFor(view) || SEARCH_FROM.includes(view))
      this.#type({ command: "typeOpen" }, "screen");
  }

  /** A printable key on the Library's first page opens search with it already typed. */
  #screenKey(text: string | undefined): void {
    if (this.#state.view !== "library" || text === undefined || [...text].length !== 1) return;
    this.#type({ command: "typeOpen", args: { text } }, "screen");
  }

  /**
   * While the Screen types: Esc/Back leaves the field, Down goes to the results, and anything else
   * from a phone or the mouse ends the session before it does its usual job. True when handled here.
   */
  #typingKeys(command: Command, from: Source): boolean {
    if (this.#state.typingBy !== "screen") return false;
    const name = command.command;
    if (name === "back") {
      this.#type({ command: "typeCancel" }, "screen");
    } else if (from === "screen" && NAV.includes(name)) {
      if (name === "down" && this.#typingFor === "librarySearch")
        this.#type({ command: "typeSubmit" }, "screen");
    } else if (NAV.includes(name) || name === "ok") {
      this.#endTyping();
      return false;
    } else {
      return false;
    }
    this.#emit();
    return true;
  }

  /** Moving up onto the search field from the results types there again. */
  #fieldReached(): void {
    if (this.#state.view !== "librarySearch" || this.#state.typingBy !== undefined) return;
    const item = resolveFocus(this.#currentGrid(), this.#state.focus[this.viewKey]);
    if (item?.id === "field") this.#search.action("search:field", "screen");
  }

  /** An edit of App search text typed on the Mac keyboard while Couch captures it. */
  #onEdit(edit: TextEdit): void {
    if (this.#state.typingBy !== "screen" || this.#typingFor !== "search") return;
    if (this.#state.view !== "app") return;
    if ("done" in edit) {
      this.#type({ command: edit.done === "submit" ? "typeSubmit" : "typeCancel" }, "screen");
      return;
    }
    this.#state.query = applyEdit(this.#state.query, edit);
  }

  /** Mac-keyboard text for an App is captured only while the Screen owns a search session. */
  #syncCapture(): void {
    const front = this.#front();
    const app =
      front?.typing && this.#state.typingBy === "screen" && this.#typingFor === "search"
        ? front.typing
        : undefined;
    if (app === this.#capturing) return;
    this.#capturing?.captureText(false);
    this.#capturing = app;
    app?.captureText(true);
  }

  #type(command: Command, from: Source): void {
    const owner = this.#state.typingBy;
    if (command.command === "typeOpen") {
      const purpose = this.#purposeFor(this.#state.view);
      if (!purpose) return this.#toast(this.#typingHint());
      // The latest of a phone and the Screen to open takes over; one phone can't take from another.
      if (owner !== undefined && owner !== from && from !== "screen" && owner !== "screen") return;
      if (owner !== undefined && owner !== from) this.#endTyping();
      return this.#typeFor(purpose, command, from);
    }
    if (owner === undefined || this.#typingFor === undefined) return;
    this.#typeFor(this.#typingFor, command, from);
  }

  #typingHint(): string {
    const names = [...this.#apps.values()].filter((a) => a.typing).map((a) => `${a.label} search`);
    return `Typing works inside ${names.join(" or ")}`;
  }

  #typeFor(purpose: Purpose, command: Command, from: Source): void {
    const owner = this.#state.typingBy;
    if (purpose === "tmdbKey") return this.#detailsPage.typeKey(command, from);
    if (purpose === "librarySearch") return this.#search.type(command, from);
    switch (command.command) {
      case "typeOpen":
        if (owner !== undefined && owner !== from) return;
        this.#state.typingBy = from;
        this.#typingFor = "search";
        this.#state.query = "";
        break;
      case "typeText":
        if (owner !== from) return;
        this.#state.query = command.args?.text ?? "";
        break;
      case "typeSubmit":
        if (owner !== from) return;
        if (this.#state.query.trim()) this.#front()?.typing?.submitSearch(this.#state.query);
        this.#state.typingBy = undefined;
        break;
      case "typeCancel":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        break;
    }
  }

  /** Confirming "Quit Couch?" (⌘Q in Couch's menu, Settings → Quit) and phone Power: the normal quit, saving the position first. */
  quit(): void {
    this.savePlayingPosition();
    this.#ports.mac.quit();
  }

  /** Couch's own ⌘Q and Settings → Quit ask first; every other quit goes straight through the app's before-quit. */
  askQuit(): void {
    this.#askQuit();
  }

  #askQuit(): void {
    this.#ask("Quit Couch?", ["Cancel", "Quit"], [() => {}, () => this.quit()]);
    this.#emit();
  }

  #ask(title: string, buttons: [string, string], answers: [() => void, () => void]): void {
    this.#state.confirm = { title, buttons, focus: 0 };
    this.#confirmAnswers = answers;
  }

  #dismissConfirm(): void {
    this.#state.confirm = undefined;
    this.#confirmAnswers = undefined;
  }

  /** D-pad, OK and Back answer the question; other commands (Home, volume...) carry on. */
  #confirmCommand(command: Command): boolean {
    const c = this.#state.confirm;
    if (!c) return false;
    switch (command.command) {
      case "left":
      case "up":
        c.focus = 0;
        break;
      case "right":
      case "down":
        c.focus = 1;
        break;
      case "ok": {
        const answer = this.#confirmAnswers?.[c.focus];
        this.#dismissConfirm();
        answer?.();
        break;
      }
      case "back":
        this.#dismissConfirm();
        break;
      case "home":
      case "power":
        this.#dismissConfirm();
        return false;
      default:
        return false;
    }
    this.#emit();
    return true;
  }

  /** ⌘Q and Settings → Quit: end playback (saving the position) and stop the player. */
  beforeQuit(): void {
    if (this.#state.player) {
      this.#stopPlayback();
      this.#endPlayback();
    }
  }

  #readTimeFormat(): void {
    const next = this.#ports.mac.timeFormat();
    if (next === this.#timeFormat) return;
    this.#timeFormat = next;
    this.#emit();
  }

  /** Ambient mode: after 2 idle minutes on Home the App row and top strip fade away. */
  #armAmbient(): void {
    this.#cancelAmbient?.();
    this.#cancelAmbient = undefined;
    if (this.#state.view !== "home") return;
    this.#cancelAmbient = this.#ports.clock.setTimeout(() => {
      this.#cancelAmbient = undefined;
      if (this.#state.view !== "home") return;
      this.#ambient = true;
      this.#emit();
    }, AMBIENT_MS);
  }

  #armIdle(): void {
    this.#cancelIdle?.();
    this.#idle = false;
    this.#cancelIdle = this.#ports.clock.setTimeout(() => {
      this.#idle = true;
      this.#syncDisplayAwake();
    }, IDLE_DISPLAY_MS);
  }

  /** Hold the display awake while playing, in an App, or within 30 minutes of the last command. */
  #syncDisplayAwake(): void {
    const keep = !!this.#state.player || this.#state.view === "app" || !this.#idle;
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
    this.details.dispose();
    this.#sound.dispose();
    this.#thumbs.dispose();
    this.#unsubDisplays();
    this.#cancelIdle?.();
    this.#cancelToast?.();
    this.#cancelMinute?.();
    this.#cancelAmbient?.();
    this.#offTimeFormat?.();
    this.#controls.dispose();
    this.#cancelSaves?.();
    this.#cancelNote?.();
    this.#cancelVolume?.();
    this.#unsubPlayer();
    for (const off of this.#appsOff) off();
    this.#listeners.clear();
  }

  #move(direction: "up" | "down" | "left" | "right"): void {
    const grid = this.#currentGrid();
    const current = resolveFocus(grid, this.#state.focus[this.viewKey]);
    const front = this.#front();
    if (front) return front.sendKey(direction);
    if (!current) return;
    if (this.#state.view === "show") {
      this.#show.move(direction);
      this.#show.syncTab();
      return;
    }
    const next = moveFocus(grid, current, direction);
    this.#state.focus[this.viewKey] = { r: next.r, c: next.c };
  }

  #focusAt(r?: number, c?: number): void {
    if (this.#state.view === "app") return;
    if (this.#state.view === "player" && this.#state.controls === "hidden") return;
    const item = this.#currentGrid().find((i) => i.r === r && i.c === c);
    if (!item) return;
    this.#state.focus[this.viewKey] = { r: item.r, c: item.c };
    this.#show.syncTab();
    this.#controls.cardActivity();
    this.#emit();
  }

  #ok(): void {
    const front = this.#front();
    if (front) return front.sendKey("ok");
    const grid = this.#currentGrid();
    const item = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!item) return;
    if (item.action === "back") return this.#back();
    if (
      this.#libraryAction(item.action) ||
      this.#detailsPage.action(item.action, this.#source) ||
      this.#sound.action(item.action) ||
      this.#addonsPage.action(item.action) ||
      this.#search.action(item.action, this.#source) ||
      this.#show.action(item.action)
    )
      return;
    const action = actionFor(item.action);
    // Placeholder Apps until they exist.
    if (action) action(this.#actionContext());
    else this.#toast(`${item.label} is coming soon`);
  }

  #back(): void {
    const front = this.#front();
    if (front) {
      if (front.back() === "leave") {
        this.#ask(
          `Leave ${front.label}?`,
          ["Stay", "Go to Home"],
          [() => {}, () => this.#setView("home")],
        );
        this.#leaveConfirm = this.#state.confirm;
      }
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
    if (this.#state.view === "library" && this.#chip) {
      this.#chip = undefined;
      this.#state.focus[this.viewKey] = { r: 1, c: 0 };
      return;
    }
    if (this.#state.view === "librarySearch") return this.#setView("library");
    if (this.#state.view === "show" && this.#showFrom === "librarySearch")
      return this.#setView("librarySearch");
    if (this.#state.view === "fixMatch") {
      this.#show.leaveFix();
      this.#keepLibraryFocus();
      return;
    }
    const target = BACK_TARGETS[this.#state.view];
    if (target) this.#setView(target);
    this.#keepLibraryFocus();
  }

  /** Changes view; leaving an App hides it (pausing playback) and lets the display sleep again. */
  #setView(view: View): void {
    const from = this.#state.view;
    if (view === "home") {
      this.#chip = undefined;
      this.#lastTile = undefined;
      delete this.#state.focus.home;
      this.#homeFilm = undefined;
    }
    if (from === view) return;
    if (from === "app") {
      if (this.#leaveConfirm && this.#state.confirm === this.#leaveConfirm) this.#dismissConfirm();
      this.#state.typingBy = undefined;
      this.#apps.get(this.#state.app ?? "")?.hide();
    }
    if (view !== "app" && view !== "appError") delete this.#state.app;
    this.#state.view = view;
    this.#ambient = false;
    this.#armAmbient();
    this.#releaseStrayTyping();
    if (from === "details") this.#detailsPage.cancel();
    if (view === "library") void this.library.refresh(this.#libraryFolders);
    if (view === "settings") void this.refreshLoginItem();
  }

  #openApp(id: string): void {
    const app = this.#apps.get(id);
    if (!app) return;
    this.#state.app = id;
    if (this.#appsFailed.has(id)) {
      this.#setView("appError");
      return;
    }
    this.#setView("app");
    app.show(APP_NOTE);
  }

  #retryApp(): void {
    const id = this.#state.app;
    const app = this.#apps.get(id ?? "");
    if (!id || !app) return;
    this.#appsFailed.delete(id);
    app.restart();
    this.#openApp(id);
  }

  #restartApp(id: string): void {
    const app = this.#apps.get(id);
    if (!app) return;
    this.#appsFailed.delete(id);
    app.restart();
    this.#toast(`Restarting ${app.label}`);
  }

  #onApp(app: App, event: AppEvent): void {
    const front = this.#state.app === app.id;
    switch (event.type) {
      case "loaded":
        this.#appsFailed.delete(app.id);
        break;
      case "failed":
        this.#appsFailed.add(app.id);
        if (this.#state.view === "app" && front) this.#setView("appError");
        break;
      case "key":
        this.handle({ command: event.command }, "screen");
        return;
      case "find":
        if (this.#state.view === "app" && front) this.handle({ command: "find" }, "screen");
        return;
      case "edit":
        if (front) this.#onEdit(event.edit);
        break;
      case "output":
        this.#sound.appOutput(app.id, event.name, event.ok);
        return;
      case "searchOpened":
        if (
          this.#state.view === "app" &&
          front &&
          this.#state.typingBy === undefined &&
          this.#lastFrom !== undefined &&
          this.#remotes.has(this.#lastFrom)
        ) {
          this.#state.typingBy = this.#lastFrom;
          this.#typingFor = "search";
          this.#state.query = "";
        }
        break;
      default:
        return;
    }
    this.#emit();
  }

  /** An App covers the Screen, so what Couch draws over it (volume, question, search bar) goes through the App. */
  #syncApps(): void {
    const front = this.#front();
    for (const app of this.#apps.values()) {
      const shown = this.#shown.get(app.id) ?? {};
      const on = app === front;
      const volume = on && this.#state.volumeShown ? this.#state.volume : undefined;
      if (volume !== shown.volume) {
        shown.volume = volume;
        app.drawVolume(volume);
      }
      const c = on ? this.#state.confirm : undefined;
      if (c?.title !== shown.confirm?.title || c?.focus !== shown.confirm?.focus) {
        shown.confirm = c && { ...c };
        app.showConfirm(c && { ...c });
      }
      const bar =
        on && this.#state.typingBy !== undefined && this.#typingFor === "search"
          ? this.#state.query
          : undefined;
      if (bar !== shown.bar) {
        shown.bar = bar;
        app.typing?.showSearchBar(bar);
      }
      this.#shown.set(app.id, shown);
    }
  }

  #setVolume(percent: number): void {
    const volume = Math.max(0, Math.min(100, Math.round(percent)));
    this.#state.volume = volume;
    this.#sound.setVolume(volume);
    this.#state.volumeShown = true;
    this.#cancelVolume?.();
    this.#cancelVolume = this.#ports.clock.setTimeout(() => {
      this.#state.volumeShown = false;
      this.#emit();
    }, OVERLAY_MS);
    this.#emit();
  }

  #actionContext(): ActionContext {
    return {
      open: (view) => this.#setView(view),
      openApp: (id) => this.#openApp(id),
      retryApp: () => this.#retryApp(),
      restartApp: (id) => this.#restartApp(id),
      toast: (text) => this.#toast(text),
      forgetAllPhones: () => this.forgetAllPhones(),
      toggleListener: () => void this.#toggleListener(),
      quit: () => this.#askQuit(),
    };
  }

  #loginItem = { available: false, on: false, running: false };

  /** Reads the login item and whether a listener is really up (status file, pid, port) from the Mac. */
  async refreshLoginItem(): Promise<void> {
    const item = await this.#ports.mac.listenerLoginItem().catch(() => this.#loginItem);
    const running =
      item.available &&
      !!(await liveListener(this.#ports.store, this.#ports.listenerProbe ?? systemProbe).catch(
        () => undefined,
      ));
    this.#loginItem = { available: item.available, on: item.on, running };
    this.#emit();
  }

  async #toggleListener(): Promise<void> {
    await this.refreshLoginItem();
    if (!this.#loginItem.available) return;
    const turnOn = !this.#loginItem.on;
    const door = this.#ports.frontdoor;
    if (turnOn) await door?.beforeEnable().catch(() => {});
    await this.#ports.mac.setListenerLoginItem(turnOn).catch(() => {});
    await this.refreshLoginItem();
    await door?.afterChange(this.#loginItem.on).catch(() => {});
    await this.refreshLoginItem();
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
      this.#readTimeFormat();
      this.#emit();
      this.#scheduleMinute();
    }, wait);
  }

  /** Typing belongs to one view; leaving it closes the sheet. The search query outlives it only for Back. */
  #releaseStrayTyping(): void {
    const { view, typingBy } = this.#state;
    if (typingBy !== undefined && TYPING_VIEW[this.#typingFor ?? "search"] !== view) {
      this.#state.typingBy = undefined;
      this.#typingFor = undefined;
    }
    if (!SEARCH_KEEPS.includes(view)) this.#search.reset();
  }

  #emit(): void {
    this.#releaseStrayTyping();
    const raised =
      this.#state.controls !== "hidden" &&
      this.#state.controls !== "next" &&
      this.#state.player !== undefined;
    const level = `${raised}${this.#state.controls === "upnext"}`;
    if (level !== this.#subtitlesRaised) {
      this.#subtitlesRaised = level;
      this.#ports.player.setSubtitlesRaised(raised, this.#state.controls === "upnext");
    }
    this.#syncDisplayAwake();
    this.#syncApps();
    this.#syncCapture();
    for (const l of [...this.#listeners]) l();
  }
}
