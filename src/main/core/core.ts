import { existsSync } from "node:fs";
import { dirname, basename } from "node:path";
import {
  VIEW_LABELS,
  type LibraryEntry,
  type LibraryPayload,
  type ShowEpisode,
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
import type { Thumbnails } from "../ports/thumbnails.ts";
import { ThumbnailScheduler } from "./thumbnail-scheduler.ts";
import { ACTIONS, BACK_TARGETS, type ActionContext } from "./actions.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import { MediaLibrary } from "./media-library.ts";
import { artFor, type PathArt } from "./art.ts";
import { libraryRows, tileAction } from "./library-rows.ts";
import { presentation, hueFor, listFolder, mosaicSources, rootEntries } from "./library.ts";
import type { UpNextItem } from "../../shared/protocol.ts";
import { PlayerControls } from "./player-controls.ts";
import { History } from "./history.ts";
import { EXTRAS_TAB, allEpisodes, primaryFor, tabIds, tabOf } from "./show-page.ts";
import type { MatchOption } from "./metadata-service.ts";
import { MetadataService } from "./metadata-service.ts";
import { nullMetadata, type Metadata } from "../ports/metadata.ts";

/** In-progress videos shown on Home. */
const HOME_VIDEOS = 3;
const TILE_COLUMNS = 4;
const LIBRARY_VIEWS = ["library", "folder", "libraryFolders"];

export interface Ports {
  player: Player;
  youtube: YouTube;
  mac: Mac;
  clock: Clock;
  store: Store;
  thumbnails?: Thumbnails;
  /** Show and film details (TMDB). Without it, everything uses frames. */
  metadata?: Metadata;
  /** The project's TMDB key, built into release builds; used when the household has none of its own. */
  tmdbProjectKey?: string;
}

/** Who sent a command: a connected phone, or the Screen's own keyboard. */
export type Source = RemoteId | "screen";

const TOAST_MS = 3000;
const IDLE_DISPLAY_MS = 30 * 60_000;
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
  /** A TMDB key being typed on a phone. Kept out of the Screen state and snapshots. */
  #keyDraft = "";
  /** What the phone currently typing is typing into. */
  #typingFor: "search" | "tmdbKey" | undefined;
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
    this.library = new MediaLibrary(ports.store, ports.clock);
    this.details = new MetadataService({
      store: ports.store,
      clock: ports.clock,
      port: ports.metadata ?? nullMetadata,
      library: this.library,
      projectKey: ports.tmdbProjectKey,
      changed: () => this.#emit(),
    });
    this.library.onChange(() => {
      this.details.sync();
      this.#keepLibraryFocus();
      this.#emit();
    });
    this.details.sync();
    this.#controls = new PlayerControls(this.#state, {
      clock: ports.clock,
      playing: () => {
        const p = this.#state.player;
        return p && { path: p.path, position: p.pos, paused: p.paused };
      },
      seekTo: (seconds) => this.#seekTo(seconds),
      togglePause: () => this.#togglePause(),
      toggleSubtitles: () => this.#toggleSubtitles(),
      setVolume: (percent) => void this.#setVolume(percent),
      play: (path) => this.#play(path),
      leave: () => this.#endPlayback(undefined, true),
      changed: () => this.#emit(),
    });
    this.#thumbs = new ThumbnailScheduler(ports.thumbnails, () => this.#emit());
    this.#libraryFolders = Array.isArray(lib.folders)
      ? lib.folders.filter((f): f is string => typeof f === "string")
      : [];
    void this.library.refresh(this.#libraryFolders);
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
          entries: rootEntries(this.#libraryFolders).map((e) => ({
            ...this.#withMosaic(e),
            feature: { kind: "Folder" as const, title: e.title },
          })),
          continueWatching: this.#continueEntries(),
          rows: this.#rows().rows,
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

  /** The tile focused on the Library's first page, so rows that change under it don't move focus. */
  #rootFocusId: string | undefined;

  #keepLibraryFocus(): void {
    if (this.#state.view !== "library" || !this.#rootFocusId) return;
    const at = this.#currentGrid().find((i) => i.id === this.#rootFocusId);
    if (at) this.#state.focus[this.viewKey] = { r: at.r, c: at.c };
  }

  #rows(): ReturnType<typeof libraryRows> {
    return libraryRows({
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
      const newest = videos[0];
      if (!newest) return base;
      const apps = base.filter((i) => i.id !== "settings");
      return [
        ...base.filter((i) => i.id === "settings"),
        {
          id: "resume",
          r: 1,
          c: 0,
          label: `Resume ${newest.title}`,
          action: `library:play:${newest.path}`,
          initial: true,
        },
        {
          id: "fromstart",
          r: 1,
          c: 1,
          label: `${newest.title} from start`,
          action: `library:playstart:${newest.path}`,
        },
        ...apps.map((i) => ({ ...i, r: 2, initial: false })),
        ...videos.map((v, i) => ({
          id: v.path,
          r: 2,
          c: apps.length + i,
          label: v.title,
          action: `library:play:${v.path}`,
        })),
      ];
    }
    if (this.#state.view === "player") return this.#controls.grid();
    if (this.#state.view === "details") return this.#detailsGrid();
    if (this.#state.view === "show") return this.#showGrid();
    if (this.#state.view === "fixMatch") return this.#fixGrid();
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
    // Row 0 is the top strip's gear, as on Home; each page row is one grid row, Folders wrap below.
    const rows = lib.rows ?? [];
    const tiles = [
      ...rows.flatMap((row, r) => row.entries.map((e, c) => tile(e, 1 + r, c, r === 0 && c === 0))),
      ...lib.entries.map((e, i) =>
        tile(
          e,
          1 + rows.length + Math.floor(i / TILE_COLUMNS),
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
    return [gear, ...tiles];
  }

  #detailsGrid(): GridItem[] {
    const s = this.details.settings();
    const rows: Omit<GridItem, "r" | "c">[] = [
      { id: "own-key", label: "Use my own key", action: "details:own-key", initial: true },
      ...(s.hasOwnKey
        ? [{ id: "remove-key", label: "Remove my key", action: "details:remove-key" }]
        : []),
      { id: "toggle", label: "Online details", action: "details:toggle" },
      { id: "refresh", label: "Refresh details", action: "details:refresh" },
      { id: "credits", label: "Credits", action: "details:credits" },
    ];
    return rows.map((row, r) => ({ ...row, r, c: 0 }));
  }

  /** Actions on the "Show and film details" page. */
  #detailsAction(action: string): boolean {
    if (!action.startsWith("details:")) return false;
    switch (action) {
      case "details:own-key":
        // The key is typed on a phone's typing sheet.
        if (this.#lastFrom !== undefined && this.#remotes.has(this.#lastFrom))
          this.#startKeyTyping(this.#lastFrom);
        else this.#toast("Open Couch's Remote on your phone to type the key");
        break;
      case "details:remove-key":
        this.details.setKey(undefined);
        this.#toast("Using the built-in key");
        break;
      case "details:toggle":
        this.details.setEnabled(!this.details.settings().enabled);
        break;
      case "details:refresh":
        this.details.refresh();
        this.#toast("Refreshing details");
        break;
      case "details:credits":
        this.#setView("credits");
        break;
      default:
        return false;
    }
    return true;
  }

  #startKeyTyping(remote: RemoteId): void {
    this.#state.typingBy = remote;
    this.#typingFor = "tmdbKey";
    this.#keyDraft = "";
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

  /** OK on a show tile: the show page, focused on the episode its primary button plays. */
  #openShow(id: string): void {
    const show = this.library.show(id);
    if (!show) return;
    this.#state.showId = id;
    const primary = primaryFor(show, this.#history);
    if (primary) this.#focusShowEpisode(primary.episode.path);
    else this.#state.showTab = tabIds(show)[0];
    this.#setView("show");
    this.#wantShowPictures();
  }

  /** Back on the show page after playback: focus the episode played, or the next one after an end. */
  #returnToShow(path: string, ended: boolean): void {
    const show = this.library.show(this.#state.showId!);
    if (!show) {
      this.#state.view = "library";
      return;
    }
    const next = ended ? this.library.nextEpisode(path) : undefined;
    this.#focusShowEpisode(next?.path ?? path);
    this.#state.view = "show";
    this.#wantShowPictures();
  }

  /** Select the episode's season tab and focus its row. */
  #focusShowEpisode(path: string): void {
    const show = this.#state.showId ? this.library.show(this.#state.showId) : undefined;
    const episode = show && allEpisodes(show).find((e) => e.path === path);
    if (!show || !episode) return;
    const tab = tabOf(episode);
    this.#state.showTab = tab;
    const index = show.seasons.find((se) => String(se.number) === tab)!.episodes.indexOf(episode);
    this.#state.focus[`show:${show.id}`] = { r: 1 + index, c: 1 + tabIds(show).indexOf(tab) };
  }

  /** The episodes (or extras) listed under the selected tab. */
  #showList(show: NonNullable<ReturnType<MediaLibrary["show"]>>): ShowEpisode[] {
    const tab = this.#state.showTab;
    const decorate = (e: ShowEpisode, path: string): ShowEpisode => {
      const { episode } = this.#art(path);
      const thumb = episode?.still ?? this.#thumbs.urlFor(path);
      const progress = this.#history.progress(path);
      const left = progress
        ? Math.max(1, Math.ceil((progress.duration - progress.position) / 60))
        : 0;
      return {
        ...e,
        ...(episode?.name && e.number !== undefined ? { title: episode.name } : {}),
        ...(episode?.overview ? { overview: episode.overview } : {}),
        ...(thumb ? { thumb } : {}),
        ...(progress
          ? {
              progress: {
                fraction: progress.position / progress.duration,
                left: `${left} min left`,
              },
            }
          : this.#history.isWatched(path)
            ? { watched: true }
            : {}),
      };
    };
    if (tab === EXTRAS_TAB) {
      return show.extras.map((x) =>
        decorate(
          {
            id: x.path,
            title: x.title,
            hue: hueFor(x.title),
            ...(x.missing ? { missing: true } : {}),
          },
          x.path,
        ),
      );
    }
    const season = show.seasons.find((se) => String(se.number) === tab) ?? show.seasons[0];
    return (season?.episodes ?? []).map((e) =>
      decorate(
        {
          id: e.path,
          number: e.episode,
          title: presentation(e.path).title,
          hue: hueFor(show.name),
          ...(e.missing ? { missing: true } : {}),
        },
        e.path,
      ),
    );
  }

  #wantShowPictures(): void {
    const show = this.#state.showId ? this.library.show(this.#state.showId) : undefined;
    if (!show) return;
    const primary = primaryFor(show, this.#history)?.episode.path;
    this.#thumbs.want([...(primary ? [primary] : []), ...this.#showList(show).map((e) => e.id)]);
  }

  #canFix(): boolean {
    const d = this.details.settings();
    return d.enabled && d.keyLabel !== "No key";
  }

  #showGrid(): GridItem[] {
    const show = this.#state.showId ? this.library.show(this.#state.showId) : undefined;
    if (!show) return [];
    const tabs = tabIds(show);
    const selected = Math.max(0, tabs.indexOf(this.#state.showTab ?? ""));
    const primary = primaryFor(show, this.#history);
    const grid: GridItem[] = [
      { id: "play", r: 0, c: 0, label: primary?.label ?? "Play", action: "show:play" },
      ...tabs.map((t, i) => ({
        id: `tab:${t}`,
        r: 0,
        c: 1 + i,
        label: t === EXTRAS_TAB ? "Extras" : `Season ${t}`,
        action: `show:tab:${t}`,
      })),
      ...this.#showList(show).map((e, i) => ({
        id: e.id,
        r: 1 + i,
        c: 1 + selected,
        label: e.title,
        action: `library:play:${e.id}`,
      })),
    ];
    if (this.#canFix())
      grid.push({ id: "fix", r: 1, c: 0, label: "Fix match", action: "show:fix" });
    const first = grid.find((i) => i.id === primary?.episode.path) ?? grid[0];
    if (first) first.initial = true;
    return grid;
  }

  #fixOptions: MatchOption[] | undefined;

  #fixGrid(): GridItem[] {
    const options = this.#fixOptions ?? [];
    return [
      ...options.map((o, i) => ({
        id: `cand:${o.tmdbId}`,
        r: i,
        c: 0,
        label: o.name,
        action: `fix:${o.tmdbId}`,
        initial: i === 0,
      })),
      {
        id: "frames",
        r: options.length,
        c: 0,
        label: "Use video frames",
        action: "fix:frames",
        initial: options.length === 0,
      },
    ];
  }

  #showAction(action: string): boolean {
    const [ns, verb, ...rest] = action.split(":");
    const arg = rest.join(":");
    if (ns === "fix") {
      this.#applyFix(verb === "frames" ? "frames" : Number(verb));
      return true;
    }
    if (ns !== "show") return false;
    const show = this.#state.showId ? this.library.show(this.#state.showId) : undefined;
    if (!show) return true;
    if (verb === "play") {
      const primary = primaryFor(show, this.#history);
      if (primary) this.#play(primary.episode.path, primary.fromStart);
    } else if (verb === "tab") {
      this.#state.showTab = arg;
      this.#wantShowPictures();
      const list = this.#showList(show);
      const c = 1 + tabIds(show).indexOf(arg);
      if (list.length) this.#state.focus[this.viewKey] = { r: 1, c };
    } else if (verb === "fix") {
      this.#openFixMatch(show.id);
    }
    return true;
  }

  /** Where Fix match was opened from, and for which show or film. */
  #fixId: string | undefined;
  #fixBack: "show" | "library" = "show";

  /** The show or film under the focused Library tile, when its match can be fixed. */
  #fixTarget(): string | undefined {
    if (this.#state.view !== "library" || !this.#canFix()) return undefined;
    const focused = resolveFocus(this.#currentGrid(), this.#state.focus[this.viewKey]);
    const entry = this.#rows()
      .rows.flatMap((r) => r.entries)
      .find((e) => (e.id ?? e.path) === focused?.id);
    if (!entry || entry.missing) return undefined;
    if (entry.kind === "show") return entry.path;
    if (entry.kind !== "video" || this.library.showOf(entry.path)) return undefined;
    return this.library.films().some((f) => f.path === entry.path) ? entry.path : undefined;
  }

  /** Menu key, long press or the phone's button: Fix match for the focused show or film. */
  #menu(): void {
    if (this.#state.view === "show" && this.#state.showId && this.#canFix())
      return this.#openFixMatch(this.#state.showId, "show");
    const id = this.#fixTarget();
    if (id) this.#openFixMatch(id, "library");
  }

  #openFixMatch(id: string, back: "show" | "library" = "show"): void {
    this.#fixId = id;
    this.#fixBack = back;
    this.#fixOptions = undefined;
    delete this.#state.focus.fixMatch;
    this.#state.view = "fixMatch";
    void this.details.candidates(id).then((options) => {
      if (this.#state.view !== "fixMatch" || this.#fixId !== id) return;
      this.#fixOptions = options;
      this.#emit();
    });
  }

  #applyFix(choice: number | "frames"): void {
    const id = this.#fixId;
    if (!id) return;
    this.#state.view = this.#fixBack;
    this.#toast(choice === "frames" ? "Using video frames" : "Fixing the match");
    void this.details.fixMatch(id, choice).then(() => this.#emit());
  }

  /** After a move or hover onto a season tab, the list below follows. */
  #syncShowTab(): void {
    if (this.#state.view !== "show") return;
    const focused = resolveFocus(this.#currentGrid(), this.#state.focus[this.viewKey]);
    if (focused?.id.startsWith("tab:")) {
      const tab = focused.id.slice(4);
      if (tab !== this.#state.showTab) {
        this.#state.showTab = tab;
        this.#wantShowPictures();
      }
    }
  }

  #moveShow(direction: "up" | "down" | "left" | "right"): void {
    const grid = this.#currentGrid();
    const current = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!current) return;
    const set = (i: GridItem) => (this.#state.focus[this.viewKey] = { r: i.r, c: i.c });
    const buttons = grid.filter((i) => i.c === 0);
    if (current.c === 0) {
      if (direction === "right") {
        const primary = grid.find((i) => i.initial && i.c > 0);
        const target =
          primary ?? grid.find((i) => i.c > 0 && i.r >= 1) ?? grid.find((i) => i.c > 0);
        if (target) set(target);
      } else if (direction !== "left") {
        set(moveFocus(buttons, current, direction));
      }
      return;
    }
    const next = moveFocus(grid, current, direction);
    if (direction === "left" && (next === current || current.r >= 1)) {
      set(grid.find((i) => i.id === "play")!);
    } else set(next);
  }

  #libraryAction(action: string): boolean {
    if (!action.startsWith("library:")) return false;
    const [, verb, ...rest] = action.split(":");
    const arg = rest.join(":");
    if (verb === "missing") this.#toast("Connect the drive to see this folder");
    else if (verb === "open") this.#openFolder(arg);
    else if (verb === "play") this.#play(arg);
    else if (verb === "playstart") this.#play(arg, true);
    else if (verb === "show") this.#openShow(arg);
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
      this.#returnToShow(p.path, ended);
    } else {
      this.#state.view = this.#playedFrom === "show" ? "library" : this.#playedFrom;
    }
    if (toast) this.#toast(toast);
    this.#keepLibraryFocus();
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
        if (name === "home") this.#state.view = "home";
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
      if (name === "home") this.#state.view = "home";
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
      library: this.#library(),
      ...(this.#state.view === "show" ? this.#showPayload() : {}),
      ...(this.#state.view === "fixMatch" ? this.#fixPayload() : {}),
      ...(this.#state.view === "details" ||
      this.#state.view === "settings" ||
      this.#state.view === "credits"
        ? { details: this.details.settings() }
        : {}),
      continueCard: this.#continueEntries()[0],
      homeVideos,
      hero: homeVideos.find((v) => v.path === focused?.id) ?? homeVideos[0],
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

  #showPayload(): Pick<ScreenPayload, "show"> {
    const show = this.#state.showId ? this.library.show(this.#state.showId) : undefined;
    if (!show) return {};
    const primary = primaryFor(show, this.#history);
    const tabs = tabIds(show);
    const selected = tabs.includes(this.#state.showTab ?? "") ? this.#state.showTab : tabs[0];
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const d = this.details.detailsFor(show.id);
    const backdrop = d?.backdrop ?? (primary && this.#thumbs.urlFor(primary.episode.path));
    return {
      show: {
        id: show.id,
        name: show.name,
        meta: [
          ...((d?.years ?? show.year) ? [d?.years ?? String(show.year)] : []),
          plural(show.seasons.length, "season"),
          plural(show.episodeCount, "episode"),
        ],
        primary: primary?.label ?? "Play",
        ...(backdrop ? { backdrop } : {}),
        ...(d?.poster ? { poster: d.poster } : {}),
        ...(d?.overview ? { overview: d.overview } : {}),
        tabs: tabs.map((t) => ({
          id: t,
          label: t === EXTRAS_TAB ? "Extras" : `Season ${t}`,
          selected: t === selected,
        })),
        episodes: this.#showList(show),
        canFix: this.#canFix(),
      },
    };
  }

  #fixPayload(): Pick<ScreenPayload, "fixMatch"> {
    const id = this.#fixId ?? "";
    const name =
      this.library.show(id)?.name ?? this.library.films().find((f) => f.path === id)?.title ?? "";
    return {
      fixMatch: {
        name: name.replace(/\s*\(\d{4}\)$/, ""),
        loading: this.#fixOptions === undefined,
        options: (this.#fixOptions ?? []).map((o) => ({
          id: `cand:${o.tmdbId}`,
          name: o.name,
          ...(o.year ? { year: o.year } : {}),
          ...(o.poster ? { poster: o.poster } : {}),
        })),
      },
    };
  }

  snapshot(remote: RemoteId): RemoteSnapshot {
    const s = this.#state;
    const card = s.view === "home" ? this.#continueEntries()[0] : undefined;
    return {
      type: "snapshot",
      where:
        s.view === "folder"
          ? basename(s.folderPath ?? "")
          : s.view === "show"
            ? (this.library.show(s.showId ?? "")?.name ?? VIEW_LABELS.show)
            : VIEW_LABELS[s.view],
      view: s.view,
      layout: s.view === "home" || s.view === "youtube" || s.view === "player" ? s.view : "other",
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
      typeAvailable: s.view === "youtube" || s.view === "details",
      ...(this.#fixTarget() ? { fixAvailable: true } : {}),
      ...(s.view === "details" ? { typeLabel: "Type TMDB key" } : {}),
      showVolume: s.view === "youtube",
      showSkip: s.view === "youtube",
      typing: s.typingBy === undefined ? "none" : s.typingBy === remote ? "you" : "other",
      nowPlaying: s.player && {
        ...this.#present(s.player.path),
        folder: basename(dirname(s.player.path)),
        position: s.player.pos,
        duration: s.player.dur,
        paused: s.player.paused,
        subtitlesOn: s.subtitlesOn,
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
    if ((command.command === "focusAt" || command.command === "showControls") && from !== "screen")
      return;
    if (from !== "screen") this.#lastFrom = from;
    this.#ports.mac.wakeDisplay();
    this.#armIdle();
    if (command.command === "showControls" && !this.#state.player) return;
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
      case "menu":
        this.#menu();
        break;
      case "home":
        this.#setView("home");
        break;
      case "resume": {
        const newest = this.#continueEntries()[0];
        if (!newest) break;
        this.#setView("home");
        this.#play(newest.path);
        break;
      }
      case "playpause":
        if (this.#state.view === "youtube") this.#ports.youtube.playPause();
        break;
      case "seekBy":
        if (this.#state.view === "youtube") this.#ports.youtube.seekBy(command.args?.seconds ?? 0);
        break;
      case "volUp":
      case "volDown":
        void this.#setVolume(
          this.#state.volume + (command.command === "volUp" ? VOLUME_STEP : -VOLUME_STEP),
        );
        break;
      case "volSet":
        void this.#setVolume(command.args?.percent ?? this.#state.volume);
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
    if (this.#state.view === "details") return this.#typeKey(command, from);
    if (owner !== undefined && this.#typingFor !== "search") return;
    switch (command.command) {
      case "typeOpen":
        if (this.#state.view !== "youtube") return this.#toast(TYPING_HINT);
        if (from === "screen" || (owner !== undefined && owner !== from)) return;
        this.#state.typingBy = from;
        this.#typingFor = "search";
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

  /** Typing the household's TMDB key: the text never goes into the Screen state. */
  #typeKey(command: Command, from: Source): void {
    const owner = this.#state.typingBy;
    switch (command.command) {
      case "typeOpen":
        if (from === "screen" || (owner !== undefined && owner !== from)) return;
        this.#startKeyTyping(from);
        break;
      case "typeText":
        if (owner === from) this.#keyDraft = command.args?.text ?? "";
        break;
      case "typeSubmit":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        if (this.#keyDraft.trim()) {
          this.details.setKey(this.#keyDraft);
          this.#toast("TMDB key saved");
        }
        this.#keyDraft = "";
        break;
      case "typeCancel":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        this.#keyDraft = "";
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
    this.details.dispose();
    this.#thumbs.dispose();
    this.#unsubDisplays();
    this.#cancelIdle?.();
    this.#cancelToast?.();
    this.#cancelMinute?.();
    this.#controls.dispose();
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
    if (this.#state.view === "show") {
      this.#moveShow(direction);
      this.#syncShowTab();
      return;
    }
    const next = moveFocus(grid, current, direction);
    this.#state.focus[this.viewKey] = { r: next.r, c: next.c };
  }

  #focusAt(r?: number, c?: number): void {
    if (this.#state.view === "youtube") return;
    if (this.#state.view === "player" && this.#state.controls === "hidden") return;
    const item = this.#currentGrid().find((i) => i.r === r && i.c === c);
    if (!item) return;
    this.#state.focus[this.viewKey] = { r: item.r, c: item.c };
    this.#syncShowTab();
    this.#controls.cardActivity();
    this.#emit();
  }

  #ok(): void {
    if (this.#state.view === "youtube") return this.#ports.youtube.sendKey("ok");
    const grid = this.#currentGrid();
    const item = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!item) return;
    if (item.action === "back") return this.#back();
    if (
      this.#libraryAction(item.action) ||
      this.#detailsAction(item.action) ||
      this.#showAction(item.action)
    )
      return;
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
    if (this.#state.view === "fixMatch") {
      this.#state.view = this.#fixBack;
      this.#keepLibraryFocus();
      return;
    }
    const target = BACK_TARGETS[this.#state.view];
    if (target) this.#setView(target);
    this.#keepLibraryFocus();
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
    if (from === "details") {
      this.#state.typingBy = undefined;
      this.#keyDraft = "";
    }
    if (view === "library") void this.library.refresh(this.#libraryFolders);
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
          this.#typingFor = "search";
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

  async #setVolume(percent: number): Promise<void> {
    const volume = Math.max(0, Math.min(100, Math.round(percent)));
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
    this.#syncYouTubeVolume();
    for (const l of [...this.#listeners]) l();
  }
}
