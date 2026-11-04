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
  type RemoteNote,
  type RemoteSnapshot,
  type ScreenPayload,
  type ScreenState,
  type Confirmation,
  type View,
  type UiSound,
  type UiSoundEvent,
} from "../../shared/protocol.ts";
import {
  formatTime,
  type Player,
  type PlayerEvent,
  type PlayerOverlay,
  type PlayerTrack,
} from "../../shared/player.ts";
import type { Clock } from "../ports/clock.ts";
import type { Mac } from "../ports/mac.ts";
import { pickTargetDisplay } from "../display.ts";
import { APP_ENTRIES, OPEN_APP, type AppEntry } from "../apps/index.ts";
import { availableWithin } from "../apps/availability.ts";
import { copyFromCouchToast } from "../apps/sign-in-text.ts";
import {
  PlaybackUnavailable,
  type App,
  type AppEvent,
  type AppTyping,
  type NowPlayingHint,
  type PlaybackReport,
} from "../apps/app.ts";
import { randomBytes } from "node:crypto";
import type { Store } from "../ports/store.ts";
import type { Thumbnails } from "../ports/thumbnails.ts";
import { ThumbnailScheduler } from "./thumbnail-scheduler.ts";
import { confirmMouseCommand } from "../../shared/confirm-layout.ts";
import { SETTINGS_APP } from "../../shared/settings-grid.ts";
import { actionFor, BACK_TARGETS, type ActionContext } from "./actions.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import { MediaLibrary } from "./media-library.ts";
import { artFor, type PathArt } from "./art.ts";
import { libraryRows, tileAction, topGenres } from "./library-rows.ts";
import { autoRows, chipsFor, keepFor } from "./library-chips.ts";
import { presentation, hueFor, listFolder, mosaicSources, rootEntries } from "./library.ts";
import { applyEdit, type TextEdit } from "../../shared/keyboard.ts";
import type { LibraryChip, TrackList, UpNextItem } from "../../shared/protocol.ts";
import { PlayerControls } from "./player-controls.ts";
import { History } from "./history.ts";
import { ContinueApps, fromStartUrl, titleId, titleKey } from "./continue-apps.ts";
import { ContinueArt, type ArtFetch } from "./continue-art.ts";
import { ShowView } from "./show-view.ts";
import { AddonsPage } from "./addons-page.ts";
import { APPS_MENU_KEY, HomeApps, leavesOnHide } from "./home-apps.ts";
import { DetailsPage } from "./details-page.ts";
import { AboutPage } from "./about-page.ts";
import type { Updates } from "../ports/updates.ts";
import { HomePage } from "./home-page.ts";
import type { WallpaperPorts } from "../ports/pictures.ts";
import { SoundOutput } from "./sound-output.ts";
import { InterfaceSounds } from "./interface-sounds.ts";
import { QuickSettings } from "./quick-settings.ts";
import { Setup } from "./setup.ts";
import type { SetupStep } from "./setup-steps.ts";
import { LibrarySearchView } from "./library-search-view.ts";
import { AMBIENT_MS, filmAfterFocus, homeGrid } from "./home-view.ts";
import type { TimeFormat } from "../../shared/clock-format.ts";
import { AppSpeed } from "./app-speed.ts";
import { MetadataService } from "./metadata-service.ts";
import { nullMetadata, type Metadata } from "../ports/metadata.ts";

/** In-progress videos shown on Home. */
/** The key a phone fetches a picture by: the file name of its URL, without `.jpg`. */
const phoneKey = (url: string | undefined): string | undefined =>
  url
    ?.split("/")
    .pop()
    ?.replace(/\.jpg$/, "");

/** Home's update icon, in the top strip left of the gear (as the Library's search icon is). */
const UPDATE_ICON: GridItem = {
  id: "update",
  r: 0,
  c: -1,
  label: "Update ready",
  action: "open:update",
};

/** Home's row fits this many tiles: its App tiles, then Continue watching. */
const HOME_ROW_TILES = 5;
const TILE_COLUMNS = 4;
const LIBRARY_VIEWS = ["library", "folder", "libraryFolders"];
/** Views where a phone's Search button opens the Library search. */
const TYPING_VIEW = { search: "app", tmdbKey: "details", librarySearch: "librarySearch" };
type Purpose = keyof typeof TYPING_VIEW;
const SCREEN_ONLY = [
  "focusAt",
  "showControls",
  "find",
  "screenKey",
  "confirmAt",
  "quickEdge",
  "quickClose",
  "quickPick",
];
const NAV = ["up", "down", "left", "right"];
/** Keys (a phone's pad and buttons, the Mac keyboard): while Picture off is on they only bring the picture back. Playback controls (play/pause, subtitles, volume, seek...) act and leave it on. */
const PICTURE_KEYS = [
  ...NAV,
  "ok",
  "back",
  "home",
  "menu",
  "power",
  "openSettings",
  "openUpdate",
  "screenKey",
  "find",
  "typeOpen",
  "typeText",
  "typeSubmit",
  "typeCancel",
];
/** Views the Library search's query and focus survive, so Back returns to them. */
const SEARCH_KEEPS: View[] = ["librarySearch", "show", "fixMatch", "player"];
const SEARCH_FROM: View[] = ["library", "folder", "show", "librarySearch"];

export interface Ports {
  player: Player;
  /** The web Apps Home can open (see `apps/index.ts` for their entries). */
  apps: App[];
  /** The App catalog (tiles, icons, Settings actions); defaults to `APP_ENTRIES`. Injected Apps add theirs here. */
  entries?: AppEntry[];
  mac: Mac;
  clock: Clock;
  store: Store;
  thumbnails?: Thumbnails;
  /**
   * Where App titles' pictures are kept for Continue watching (`dir`), how they are downloaded (`fetch`, on a session with
   * no cookies) and each App's own artwork hosts. Without it App entries have no picture.
   */
  continueArt?: { dir: string; fetch?: ArtFetch; hosts: Record<string, string[]> };
  /** The Mac's pictures as wallpapers (its desktop picture, a folder, Apple's); without it Home offers the built-ins only. */
  wallpapers?: WallpaperPorts;
  /** The updater: Settings → About and Home's update icon (an inert one when Couch runs from the repo). */
  updates: Updates;
  /** Setup's steps; the real list unless a test adds a fake one. */
  setupSteps?: SetupStep[];
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
const LIBRARY_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const videoKey = (report: PlaybackReport) => `${report.title ?? ""}|${report.duration}`;
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
    pictureOff: false,
  };
  #grids = new Map<string, GridItem[]>();
  #remotes = new Set<RemoteId>();
  #listeners = new Set<() => void>();
  #soundListeners = new Set<(event: UiSoundEvent) => void>();
  #cancelToast: (() => void) | undefined;
  #toastId = 0;
  #cancelMinute: (() => void) | undefined;
  #key: string;
  #port = 0;
  #listener: { publicPort: number; token: string } | undefined;
  #forgetListeners = new Set<() => void>();
  #apps = new Map<string, App>();
  /** Apps that failed to load and have not loaded since. */
  /** Apps that failed to load, with why when the App said so. */
  #appsFailed = new Map<string, string | undefined>();
  #lastFrom: RemoteId | undefined;
  /** What each App was last told to draw over itself. */
  /** What each web App's page last reported playing; cleared when the App is hidden. */
  #playback = new Map<string, PlaybackReport>();
  #hints = new Map<string, NowPlayingHint>();
  #pictureOffScope: string | undefined;
  #lastSubtitles = new Map<string, string>();
  /** The speed the household chose for the playing Library video; 1 for every new video. */
  #speed = 1;
  /** The playing Library video's subtitle and audio tracks, as mpv last listed them. */
  #tracks: { subtitles: PlayerTrack[]; audio: PlayerTrack[] } = { subtitles: [], audio: [] };
  /** Each web App's wanted speed for the video it is playing (keyed by its title and length). */
  #appSpeed = new AppSpeed(() => this.#ports.clock.now());
  #shown = new Map<string, { volume?: number; confirm?: Confirmation; bar?: string }>();
  #confirmAnswers: Array<() => void> | undefined;
  /** What Back does for the open question, when it isn't "dismiss" (the welcome's Back is an answer). */
  #confirmBack: (() => void) | undefined;
  /** Apps whose welcome question is being looked up (the newest open owns it). */
  #lookups = new Map<string, number>();
  #lookupSeq = 0;
  /** Apps whose welcome question is being looked up or answered. */
  #welcoming = new Set<string>();
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
  #appTitles: ContinueApps;
  #continueArt: ContinueArt | undefined;
  /** The Library index and its Shows and Films; scans run in the background. */
  readonly library: MediaLibrary;
  /** TMDB details for Shows and Films (saved matches, Fix match, key settings). */
  readonly details: MetadataService;
  #show: ShowView;
  #detailsPage: DetailsPage;
  #about: AboutPage;
  #offUpdates: () => void;
  #addonsPage: AddonsPage;
  #homePage: HomePage;
  #homeApps: HomeApps;
  /** Apps whose Couch-Chromium sign-in exists, asked each time their menu opens. */
  #couchCopy = new Set<string>();
  #couchCheck = 0;
  #sound: SoundOutput;
  #uiSounds: InterfaceSounds;
  #quick: QuickSettings;
  #setup: Setup;
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
    const art =
      ports.continueArt && new ContinueArt(ports.continueArt.dir, ports.continueArt.fetch);
    this.#continueArt = art;
    this.#appTitles = new ContinueApps(ports.store, {
      art,
      hostsFor: (app) => ports.continueArt?.hosts[app] ?? [],
      changed: () => this.#emit(),
    });
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
    this.#uiSounds = new InterfaceSounds(ports.store);
    this.#quick = new QuickSettings({
      clock: ports.clock,
      sound: this.#sound,
      playing: () => this.#pictureScope() !== undefined,
      overMedia: () =>
        (this.#state.view === "player" && !!this.#state.player) ||
        (this.#state.view === "app" && !!this.#state.app),
      stepVolume: (delta) => this.#setVolume(this.#state.volume + delta),
      toggleMute: () => this.#toggleMute(),
      pictureIsOff: () => this.#state.pictureOff,
      setPictureOff: (on) => this.#setPictureOff(on),
      openSettings: () => {
        if (this.#state.player) {
          this.#stopPlayback();
          this.#endPlayback();
        }
        this.#setView("settings");
      },
      changed: () => this.#emit(),
    });
    this.#homePage = new HomePage({
      store: ports.store,
      wallpapers: ports.wallpapers,
      clock: ports.clock,
      toast: (text) => this.#toast(text),
      changed: () => this.#emit(),
    });
    this.#homeApps = new HomeApps({
      store: ports.store,
      known: () => this.#catalog(),
      toast: (text) => this.#toast(text),
      hidden: (id) => {
        if (!leavesOnHide(id, this.#state.view, this.#state.app)) return;
        if (this.#state.player) {
          this.#stopPlayback();
          this.#endPlayback();
        }
        this.#setView("home");
      },
      playback: (id) => {
        const playback = this.#apps.get(id)?.playback;
        return playback && { label: playback.current().label, unavailable: playback.unavailable };
      },
      hasSignIn: (id) => !!this.#apps.get(id)?.signIn,
      hasCouchCopy: (id) => this.#couchCopy.has(id),
      changed: () => {
        const at = this.#homeApps.menuRow();
        if (at >= 0) this.#state.focus.settingsApps = { r: at, c: 0 };
        this.#emit();
      },
    });
    this.#addonsPage = new AddonsPage({
      store: ports.store,
      apply: (app, ids, note) => this.#apps.get(app)?.setAddons?.(ids, note),
      isFront: (app) => this.#front()?.id === app,
      toast: (text) => this.#toast(text),
      changed: () => this.#emit(),
    });
    this.#about = new AboutPage({
      updates: ports.updates,
      ask: (title, buttons, answers, more) => this.#ask(title, buttons, answers, more),
      restart: () => {
        this.savePlayingPosition();
        ports.updates.restart();
      },
      toast: (text) => this.#toast(text),
      runSetup: () => {
        this.#setView("home");
        this.#setup.rerun();
      },
    });
    this.#offUpdates = ports.updates.onChange(() => this.#emit());
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
    this.#setup = new Setup(
      {
        store: ports.store,
        apps: {
          rows: () => this.#homeApps.rows(),
          setShown: (id, shown) => void this.#homeApps.setShown(id, shown),
        },
        atHome: () => this.#state.view === "home",
        version: () => ports.updates.version,
        listenerOn: () => this.#loginItem.on,
        turnListenerOn: () => void this.#turnListenerOn(),
        usedBefore: () => this.#usedBefore(),
        phones: () => this.#remotes.size,
        folders: () => this.#libraryFolders,
        addFolder: () => this.#addFolder(),
        anyAppOn: () => this.#homeApps.shownIds().some((id) => id !== "library"),
        later: (fn, ms) => ports.clock.setTimeout(fn, ms),
        cue: (sound) => this.#cue(sound),
        changed: () => this.#emit(),
      },
      ports.setupSteps,
    );
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

  /** Couch has been used before: a pairing from an earlier start, Library folders, or watch history (Library or Continue watching for Apps). */
  #usedBefore(): boolean {
    const store = this.#ports.store;
    const some = (v: unknown) =>
      typeof v === "object" && v !== null && Object.keys(v as object).length > 0;
    return (
      store.read("pairing", undefined) !== undefined ||
      some(store.read<{ folders?: unknown }>("library", {}).folders) ||
      some(store.read<{ items?: unknown }>("history", {}).items) ||
      some(store.read<{ items?: unknown }>("continue-apps", {}).items)
    );
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
    if (view === "settingsApps" && this.#homeApps.menuId) return APPS_MENU_KEY;
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
          continueWatching: this.#libraryContinueEntries(),
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
      continueEntries: this.#libraryContinueEntries(),
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

  /** Home's Continue watching and the Remote's card: Library videos and App titles together, newest first. */
  #continueEntries(): LibraryEntry[] {
    const videos = this.#libraryContinue();
    const titles = this.#appContinue();
    if (!titles.length) return videos.map((v) => v.entry);
    return [...videos, ...titles].sort((a, b) => b.at - a.at).map((v) => v.entry);
  }

  /**
   * Home's Continue watching: the newest entry of each App and of the Library, newest first,
   * as many as fit in the row beside the App tiles (at least one).
   */
  #homeContinue(): LibraryEntry[] {
    const seen = new Set<string>();
    const newest = this.#continueEntries().filter((e) => {
      const source = e.app?.id ?? "library";
      if (seen.has(source)) return false;
      seen.add(source);
      return true;
    });
    return newest.slice(0, Math.max(1, HOME_ROW_TILES - this.#homeApps.shownIds().length));
  }

  /** The Library's own row: its in-progress videos only. */
  #libraryContinueEntries(): LibraryEntry[] {
    return this.#libraryContinue().map((v) => v.entry);
  }

  /** Each remembered App title, as a Continue watching entry, unless its App is hidden or gone. */
  #appContinue(): Array<{ at: number; entry: LibraryEntry }> {
    return this.#appTitles.entries().flatMap((e) => {
      const app = this.#apps.get(e.app);
      const icon = this.#catalog().find((c) => c.id === e.app)?.icon;
      if (!app || !icon || !this.#homeApps.isShown(e.app)) return [];
      const fraction = Math.min(1, e.position / e.duration);
      const left = Math.max(1, Math.ceil((e.duration - e.position) / 60));
      return [
        {
          at: e.at,
          entry: {
            kind: "video",
            path: `app:${e.app}:${titleKey(e.url)}`,
            title: e.title,
            hue: hueFor(e.title),
            folder: app.label,
            ...(e.art && this.#continueArt?.fileUrl(e.art)
              ? { thumb: this.#continueArt.fileUrl(e.art) }
              : {}),
            progress: { fraction, left: `${left} min left` },
            app: {
              id: e.app,
              label: app.label,
              icon,
              fromStart: fromStartUrl(e.url) !== e.url,
            },
          } satisfies LibraryEntry,
        },
      ];
    });
  }

  /** The entry a Continue watching id (`app:<id>:<key>`) names, if it is still remembered. */
  #appTitleFor(path: string): { app: string; key: string } | undefined {
    const m = /^app:([^:]+):(.+)$/.exec(path);
    return m ? { app: m[1]!, key: m[2]! } : undefined;
  }

  /** The phone fetches an App entry's picture by key, like a Library thumbnail. */
  #appArtKey(path: string): { thumbKey?: string } {
    const id = this.#appTitleFor(path);
    const art = id && this.#appTitles.find(id.app, id.key)?.art;
    return art && this.#continueArt?.has(art) ? { thumbKey: art } : {};
  }

  /** Opens the App at where the remembered title was left (`fromStart`: at its beginning, for an App whose address carries the time). */
  #resumeAppTitle(path: string, fromStart = false): void {
    const id = this.#appTitleFor(path);
    const entry = id && this.#appTitles.find(id.app, id.key);
    const app = id && this.#apps.get(id.app);
    if (!entry || !app || !this.#homeApps.isShown(entry.app)) return;
    const hintId = titleId(entry.url);
    if (hintId)
      this.setNowPlayingHint(entry.app, {
        id: hintId,
        title: entry.title,
        ...(entry.art && this.#continueArt?.has(entry.art) ? { artKey: entry.art } : {}),
      });
    this.#openApp(entry.app, fromStart ? fromStartUrl(entry.url) : entry.url);
  }

  #libraryContinue(): Array<{ at: number; entry: LibraryEntry }> {
    if (!this.#homeApps.isShown("library")) return [];
    return this.#history.continueWatching().map((c) => {
      const { title, line } = presentation(c.path);
      const { details, episode } = this.#art(c.path);
      const thumb = this.#still(c.path, (p) => this.#thumbs.lookup(p));
      return {
        at: c.at,
        entry: this.#decorate({
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
        }),
      };
    });
  }

  #currentGrid(): GridItem[] {
    if (this.#state.view === "home") {
      const base = this.#homeBase();
      const videos = base.length ? this.#homeContinue() : [];
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
    if (this.#state.view === "soundOutput") {
      const devices = this.#sound.grid();
      return [...devices, this.#uiSounds.row(devices.length)];
    }
    if (this.#state.view === "settingsHome") return this.#homePage.grid();
    if (this.#state.view === "about") return this.#about.grid();
    if (this.#state.view === "addons") return this.#addonsPage.grid();
    if (this.#state.view === "settingsApps")
      return this.#homeApps.menuId
        ? this.#homeApps.menuGrid()
        : this.#homeApps.grid((id) => `${SETTINGS_APP}${id}`);
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
    else if (verb === "play") this.#playContinue(arg);
    else if (verb === "playstart") this.#playContinue(arg, true);
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
    else if (verb === "add") this.#addFolder();
    else return false;
    return true;
  }

  /** Removes an entry from Continue watching: an App title for good, a Library video's saved position. */
  #forgetContinue(path: string | undefined): void {
    // Only what Continue watching shows right now: not a stale or invented id, and never a finished Library video's watched record.
    if (!path || !this.#continueEntries().some((e) => e.path === path)) return;
    const id = this.#appTitleFor(path);
    const done = id ? this.#appTitles.forget(id.app, id.key) : this.#history.forget(path);
    if (done) this.#toast("Removed from Continue watching");
  }

  /**
   * Menu (or a long press) on Home's Continue watching: a small question with "Remove from Continue watching",
   * and Fix match beside it for a Library film. False when the focus is not on a Continue tile.
   */
  #continueMenu(): boolean {
    if (this.#state.view !== "home" || this.#state.confirm) return false;
    const id = resolveFocus(this.#currentGrid(), this.#state.focus.home)?.id;
    const shown = this.#homeContinue();
    // The hero's Resume / From start pills belong to the hero's entry.
    const entry = shown.find(
      (v) =>
        v.path === id || (v.path === this.#homeFilm && (id === "resume" || id === "fromstart")),
    );
    if (!entry) return false;
    const fix = entry.app ? undefined : this.#show.fixTargetFor(entry);
    this.#ask(
      entry.title,
      ["Remove from Continue watching", ...(fix ? ["Fix match"] : []), "Cancel"],
      [
        () => this.#forgetContinue(entry.path),
        ...(fix ? [() => this.#show.openFixFromHome(fix)] : []),
        () => {},
      ],
    );
    return true;
  }

  /** A Continue watching entry: a Library video, or an App title that reopens its App. */
  #playContinue(path: string, fromStart = false): void {
    if (this.#appTitleFor(path)) this.#resumeAppTitle(path, fromStart);
    else this.#play(path, fromStart);
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
    this.#tracks = { subtitles: [], audio: [] };
    if (this.#speed !== 1) {
      this.#speed = 1;
      this.#quiet(this.#ports.player.setSpeed(1));
    }
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
    this.#appTitles.flush();
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
    const base = this.#homeBase();
    const videos = this.#homeContinue();
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
      case "tracks":
        if (p) {
          this.#tracks = { subtitles: event.subtitles, audio: event.audio };
          this.#emit();
        }
        break;
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
    if (this.#state.pictureOff) {
      this.#state.pictureOff = false;
      this.#pictureOffScope = undefined;
    }
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

  /** Picture off: resume acts on what is playing only. It plays it when paused and never pauses. */
  #resumeCurrent(): void {
    const p = this.#state.player;
    if (p) {
      if (p.paused) this.#togglePause();
      return;
    }
    const front = this.#front();
    if (front && this.#playback.get(front.id)?.paused) front.playPause?.();
  }

  /** The web App's subtitles: the current track off, or the last one (else the first) back on. */
  #toggleAppSubtitles(): void {
    const front = this.#front();
    const list = front && this.#playback.get(front.id)?.tracks?.subtitles;
    if (!front?.setTrack || !list?.length) return;
    const current = list.find((t) => t.on);
    if (current && current.id !== "off") {
      this.#lastSubtitles.set(front.id, current.id);
      front.setTrack("subtitles", "off");
      return;
    }
    const last = this.#lastSubtitles.get(front.id);
    const pick = list.find((t) => t.id === last) ?? list.find((t) => t.id !== "off");
    if (pick) front.setTrack("subtitles", pick.id);
  }

  #toggleSubtitles(): void {
    this.#state.subtitlesOn = !this.#state.subtitlesOn;
    this.#ports.store.write("playback", { subtitlesOn: this.#state.subtitlesOn });
    this.#quiet(this.#ports.player.setSubtitles(this.#state.subtitlesOn));
  }

  /** Library Now Playing's choice: "off" hides subtitles, any other subtitle id shows them; audio goes straight to mpv. */
  #setTrack(kind: "subtitles" | "audio", id: string): void {
    const list = this.#tracks[kind];
    if (kind === "subtitles" && id === "off") {
      if (this.#state.subtitlesOn) this.#toggleSubtitles();
    } else {
      if (!list.some((t) => t.id === id)) return;
      if (kind === "subtitles" && !this.#state.subtitlesOn) this.#toggleSubtitles();
      this.#quiet(this.#ports.player.setTrack(kind, id));
      this.#tracks = {
        ...this.#tracks,
        [kind]: list.map((t) => ({ ...t, selected: t.id === id })),
      };
    }
    this.#emit();
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
              level: this.#level(),
              focusedId: this.#controls.focusedDock(),
              upNext: this.#controls.upNextAvailable,
            }
          : undefined,
      upNext: this.#state.controls === "upnext" ? this.#upNextTiles() : undefined,
      next: this.#nextCard(),
      paused: p.paused,
      note: this.#resumeNote,
      volume: this.#state.volumeShown ? this.#level() : undefined,
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
    return phoneKey(episode?.still ?? details?.poster ?? this.#thumbs.urlFor(path));
  }

  /** The playing video's TMDB picture (episode still, else backdrop, else poster) as a phone key; none for frames. */
  #artKey(path: string): { artKey?: string } {
    const { details, episode } = this.#art(path);
    const key = phoneKey(episode?.still ?? details?.backdrop ?? details?.poster);
    return key ? { artKey: key } : {};
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

  /** The Mac's folder picker, then the usual save and scan; Settings → Library and Setup both use it. */
  #addFolder(): void {
    void this.#ports.mac
      .pickFolder()
      .then((path) => {
        if (path && !this.#libraryFolders.includes(path))
          this.#saveFolders([...this.#libraryFolders, path]);
        this.#emit();
      })
      .catch(() => {});
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
    const homeVideos = this.#homeContinue();
    const quick = this.#quick.payload();
    const setup = this.#setup.payload();
    return {
      ...(quick ? { quick } : {}),
      ...(setup ? { setup } : {}),
      playing: this.#pictureScope() !== undefined,
      muted: this.#sound.muted,
      ...this.#backPayload(),
      library: this.#library(focused?.id),
      ...(this.#state.view === "show" ? this.#show.payload() : {}),
      ...(this.#state.view === "fixMatch" ? this.#show.fixPayload() : {}),
      ...(this.#state.view === "librarySearch" ? this.#search.payload() : {}),
      ...(this.#state.view === "details" ||
      this.#state.view === "settings" ||
      this.#state.view === "settingsLibrary" ||
      this.#state.view === "credits"
        ? { details: this.details.settings() }
        : {}),
      ...(this.#state.view === "settings" || this.#state.view === "soundOutput"
        ? { sound: this.#sound.payload() }
        : {}),
      ...(this.#state.view === "soundOutput" ? { interfaceSounds: this.#uiSounds.on } : {}),
      ...(this.#state.view === "about" ? { about: this.#about.payload() } : {}),
      homeApps: this.#homeApps.rows(),
      ...(this.#state.view === "settingsApps" || this.#state.view === "addons"
        ? { addons: this.#addonsPage.payload() }
        : {}),
      ...(this.#state.view === "settingsRemotes" ? { listener: { ...this.#loginItem } } : {}),
      ...(this.#state.view === "settingsApps" ? this.#appMenuPayload() : {}),
      home: this.#homePage.payload(this.#state.view === "settingsHome" ? focused?.id : undefined),
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
    const setup = this.#setup.payload();
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
      ...(this.#nothingPlaying()
        ? {
            apps: this.#homeApps
              .rows()
              .filter((r) => r.shown)
              .map(({ id, label, icon }) => ({ id, label, icon })),
          }
        : {}),
      ...(card
        ? {
            continueCard: {
              title: card.title,
              left: card.progress?.left ?? "",
              ...(card.app
                ? {
                    ...this.#appArtKey(card.path),
                    app: { id: card.app.id, label: card.app.label, icon: card.app.icon },
                  }
                : this.#thumbKey(card.path)
                  ? { thumbKey: this.#thumbKey(card.path) }
                  : {}),
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
      ...(this.#about.ready ? { updateReady: true as const } : {}),
      ...(s.confirm ? { confirm: s.confirm } : {}),
      ...(s.toast ? { toast: { text: s.toast, id: this.#toastId } } : {}),
      ...(s.view === "settingsApps" && this.#homeApps.menuId && this.#remoteNote()
        ? { playbackNote: this.#remoteNote() }
        : {}),
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
      nowPlaying: s.player
        ? {
            active: s.controls !== "next",
            ...this.#present(s.player.path),
            folder: basename(dirname(s.player.path)),
            position: s.player.pos,
            duration: s.player.dur,
            paused: s.player.paused,
            subtitlesOn: s.subtitlesOn,
            speed: this.#speed,
            speeds: LIBRARY_SPEEDS,
            ...this.#libraryTracks(s.subtitlesOn),
            ...this.#nowGenres(s.player.path),
            ...this.#artKey(s.player.path),
            app: this.#appFace("library", "Library"),
          }
        : this.#appNowPlaying(front),
      ...(s.player && this.#controls.upNextAvailable ? { upNext: this.#upNextItems() } : {}),
      volume: s.volume,
      muted: this.#sound.muted,
      pictureOff: s.pictureOff,
      quickSettings: this.#quick.isOpen,
      ...(setup ? { setup } : {}),
      remotes: s.remotes,
    };
  }

  #libraryTracks(subtitlesOn: boolean): { subtitles?: TrackList; audio?: TrackList } {
    const { subtitles, audio } = this.#tracks;
    const shown = subtitlesOn && subtitles.some((t) => t.selected);
    return {
      ...(subtitles.length
        ? {
            subtitles: [
              { id: "off", label: "Off", on: !shown },
              ...subtitles.map((t) => ({
                ...(t.lang ? { lang: t.lang } : {}),
                id: t.id,
                label: t.label,
                on: shown && t.selected,
              })),
            ],
          }
        : {}),
      ...(audio.length
        ? {
            audio: audio.map((t) => ({
              id: t.id,
              label: t.label,
              ...(t.lang ? { lang: t.lang } : {}),
              on: t.selected,
            })),
          }
        : {}),
    };
  }

  #appFace(id: string, label: string): { id: string; label: string; icon: string } | undefined {
    const icon = this.#catalog().find((e) => e.id === id)?.icon;
    return icon ? { id, label, icon } : undefined;
  }

  #setSpeed(speed: number | undefined): void {
    if (speed === undefined || !Number.isFinite(speed)) return;
    const player = this.#state.player;
    if (player) {
      if (!LIBRARY_SPEEDS.includes(speed)) return;
      this.#speed = speed;
      this.#quiet(this.#ports.player.setSpeed(speed));
      this.#emit();
      return;
    }
    const front = this.#front();
    const report = front && this.#playback.get(front.id);
    if (!front?.setSpeed || !report?.speeds?.includes(speed)) return;
    this.#appSpeed.command(front.id, speed, videoKey(report));
    front.setSpeed(speed);
  }

  #holdAppSpeed(app: App, report: PlaybackReport): void {
    if (!app.setSpeed || !report.speeds?.length || report.speed === undefined) return;
    const apply = this.#appSpeed.report(app.id, videoKey(report), report.speed);
    if (apply !== undefined) app.setSpeed(apply);
  }

  /**
   * Lends an App's Now Playing a title and art for a title id (what Continue knows when it opens a
   * title). Used only while a report names that id and has no title or art of its own; dropped when
   * a report names another id.
   */
  setNowPlayingHint(appId: string, hint: NowPlayingHint | undefined): void {
    if (hint) this.#hints.set(appId, hint);
    else this.#hints.delete(appId);
    this.#emit();
  }

  /** Now Playing for the front web App, from what its page last reported. */
  #appNowPlaying(front: App | undefined): RemoteSnapshot["nowPlaying"] {
    const report = front && this.#playback.get(front.id);
    if (!front || !report) return undefined;
    const hint = this.#hints.get(front.id);
    const lent = hint && report.id === hint.id ? hint : undefined;
    const artwork = report.artwork ?? lent?.artwork;
    return {
      active: !report.ended,
      title: report.title ?? lent?.title ?? front.label,
      folder: front.label,
      position: report.position,
      duration: report.duration,
      paused: report.paused,
      subtitlesOn: false,
      app: this.#appFace(front.id, front.label),
      canSeek: report.canSeek === true && !!front.seekTo,
      ...(report.tracks?.subtitles.length && front.setTrack
        ? { subtitles: report.tracks.subtitles }
        : {}),
      ...(report.tracks?.audio.length && front.setTrack ? { audio: report.tracks.audio } : {}),
      ...(report.speeds?.length && front.setSpeed
        ? { speed: report.speed ?? 1, speeds: report.speeds }
        : {}),
      ...(artwork ? { artwork } : {}),
      ...(!artwork && lent?.artKey ? { artKey: lent.artKey } : {}),
      ...(report.prompt && front.pressPrompt ? { prompt: report.prompt } : {}),
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
    this.#setup.phoneConnected();
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

  /** The Screen's Interface sounds, one per command at most. */
  onSound(listener: (event: UiSoundEvent) => void): () => void {
    this.#soundListeners.add(listener);
    return () => void this.#soundListeners.delete(listener);
  }

  handle(command: Command, from: Source): void {
    const quiet = this.#quietUi();
    this.#uiSounds.take();
    this.#handle(command, from);
    const sound = this.#uiSounds.take();
    if (!sound || quiet || this.#quietUi() || !this.#uiSounds.on || this.#sound.muted) return;
    const output = this.#sound.outputName;
    const event: UiSoundEvent = {
      sound,
      volume: this.#sound.volume,
      ...(output ? { output } : {}),
    };
    for (const l of this.#soundListeners) l(event);
  }

  /** Playback or a web App is in front: it owns the sound (and the keys), so Couch's own UI stays silent. */
  #quietUi(): boolean {
    const s = this.#state;
    return s.view === "app" || s.view === "player" || s.player !== undefined;
  }

  #cue(sound: UiSound): void {
    this.#uiSounds.cue(sound);
  }

  #handle(command: Command, from: Source): void {
    if (SCREEN_ONLY.includes(command.command) && from !== "screen") return;
    this.#source = from;
    if (from !== "screen") this.#lastFrom = from;
    this.#ports.mac.wakeDisplay();
    this.#armIdle();
    if (this.#state.pictureOff && !this.#quick.isOpen && PICTURE_KEYS.includes(command.command)) {
      this.#state.pictureOff = false;
      this.#armAmbient();
      this.#emit();
      return;
    }
    if (this.#ambient) {
      this.#ambient = false;
      this.#armAmbient();
      if (command.command !== "openApp" || !this.#canOpenShown(command.args?.app ?? "")) {
        this.#emit();
        return;
      }
    }
    this.#armAmbient();
    if (this.#setup.handle(command)) return;
    if (command.command === "openApp") {
      this.#openFromAnywhere(command.args?.app ?? "");
      this.#emit();
      return;
    }
    if (this.#quickCommand(command)) {
      this.#emit();
      return;
    }
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
        if (!this.#continueMenu()) this.#show.menu();
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
        if (this.#state.pictureOff) {
          this.#resumeCurrent();
          break;
        }
        const newest = this.#continueEntries()[0];
        if (!newest) break;
        this.#setView("home");
        this.#playContinue(newest.path);
        break;
      }
      case "forgetContinue":
        this.#forgetContinue(command.args?.entry ?? this.#continueEntries()[0]?.path);
        break;
      case "playpause":
        this.#front()?.playPause?.();
        break;
      case "subtitles":
        this.#toggleAppSubtitles();
        break;
      case "seekBy":
        this.#front()?.seekBy?.(command.args?.seconds ?? 0);
        break;
      case "seekTo":
        if (command.args?.seconds !== undefined) this.#front()?.seekTo?.(command.args.seconds);
        break;
      case "setTrack": {
        const { kind, track } = command.args ?? {};
        if ((kind === "subtitles" || kind === "audio") && track) {
          if (this.#state.player) this.#setTrack(kind, track);
          else this.#front()?.setTrack?.(kind, track);
        }
        break;
      }
      case "pressPrompt": {
        const id = command.args?.id;
        const shown = this.#front() && this.#playback.get(this.#front()!.id)?.prompt;
        if (id && shown?.id === id) this.#front()?.pressPrompt?.(id);
        break;
      }
      case "setSpeed":
        this.#setSpeed(command.args?.speed);
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
      case "mute":
        this.#toggleMute();
        break;
      case "setPictureOff":
        this.#setPictureOff(command.args?.on === true);
        break;
      case "openSettings":
        if (this.#state.view === "home") this.#setView("settings");
        break;
      case "openUpdate":
        if (this.#state.view === "home" && this.#about.ready) this.#openUpdate();
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

  /** Quick settings: opening it, and while it is open every key is its own. True when handled. */
  #quickCommand(command: Command): boolean {
    const name = command.command;
    if (name === "quickSettings" || name === "quickEdge") {
      if (this.#quick.isOpen && name === "quickEdge") return true;
      if (!this.#quick.isOpen && (this.#state.confirm || this.#state.typingBy !== undefined))
        return true;
      if (name === "quickEdge") this.#quick.open();
      else this.#quick.toggle();
      return true;
    }
    if (name === "quickClose" || name === "quickPick") return this.#quick.handle(command) || true;
    const open = this.#quick.isOpen;
    const focus = this.#quick.payload()?.focusedId;
    const handled = this.#quick.handle(command);
    if (open) this.#cueQuick(name, focus);
    return handled;
  }

  /** The drawer's keys: OK picks, Back or Right closes it, Up and Down move along its rows. */
  #cueQuick(name: string, before: string | undefined): void {
    if (name === "ok") return this.#cue("select");
    if (!this.#quick.isOpen) {
      if (name === "back" || name === "right") this.#cue("back");
      return;
    }
    if (name === "up" || name === "down")
      this.#cue(this.#quick.payload()?.focusedId === before ? "blocked" : "move");
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
      this.#back();
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

  #ask(
    title: string,
    buttons: string[],
    answers: Array<() => void>,
    more: { body?: string; back?: () => void; phone?: true } = {},
  ): void {
    this.#state.confirm = {
      title,
      ...(more.body ? { body: more.body } : {}),
      buttons,
      focus: 0,
      ...(more.phone ? { phone: true as const } : {}),
    };
    this.#confirmAnswers = answers;
    this.#confirmBack = more.back;
  }

  #dismissConfirm(): void {
    this.#state.confirm = undefined;
    this.#confirmAnswers = undefined;
    this.#confirmBack = undefined;
  }

  /** D-pad, OK and Back answer the question; other commands (Home, volume...) carry on. */
  #confirmCommand(command: Command): boolean {
    const c = this.#state.confirm;
    if (!c) return false;
    switch (command.command) {
      case "focusAt": {
        const i = command.args?.c;
        if (i !== undefined && Number.isInteger(i) && i >= 0 && i < c.buttons.length) c.focus = i;
        break;
      }
      case "confirmAt": {
        const i = command.args?.index;
        if (i === undefined || !Number.isInteger(i) || i < 0 || i >= c.buttons.length) return true;
        this.#cue("select");
        this.#answerConfirm(i);
        break;
      }
      case "confirmAnswer": {
        // A phone's own buttons: only for a question that offers them, and only for the one it is showing.
        const i = command.args?.index;
        if (!c.phone || command.args?.text !== c.title) return true;
        if (i === undefined || !Number.isInteger(i) || i < 0 || i >= c.buttons.length) return true;
        this.#answerConfirm(i);
        break;
      }
      case "left":
      case "up": {
        const next = Math.max(0, c.focus - 1);
        this.#cue(next === c.focus ? "blocked" : "move");
        c.focus = next;
        break;
      }
      case "right":
      case "down": {
        const next = Math.min(c.buttons.length - 1, c.focus + 1);
        this.#cue(next === c.focus ? "blocked" : "move");
        c.focus = next;
        break;
      }
      case "ok": {
        this.#cue("select");
        this.#answerConfirm(c.focus);
        break;
      }
      case "back": {
        this.#cue("back");
        const back = this.#confirmBack;
        this.#dismissConfirm();
        back?.();
        break;
      }
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

  #answerConfirm(index: number): void {
    const answer = this.#confirmAnswers?.[index];
    this.#dismissConfirm();
    answer?.();
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
    if (this.#state.view !== "home" || this.#setup.isOpen) return;
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
    this.#offUpdates();
    for (const off of this.#appsOff) off();
    this.#listeners.clear();
    this.#soundListeners.clear();
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
    } else {
      const next = moveFocus(grid, current, direction);
      this.#state.focus[this.viewKey] = { r: next.r, c: next.c };
    }
    // Focus that stays put met the edge of its row or page.
    const after = resolveFocus(grid, this.#state.focus[this.viewKey]);
    this.#cue(after?.id === current.id ? "blocked" : "move");
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
    this.#cue("select");
    if (item.action === "back") return this.#back();
    if (
      this.#libraryAction(item.action) ||
      this.#detailsPage.action(item.action, this.#source) ||
      this.#sound.action(item.action) ||
      this.#uiSounds.action(item.action) ||
      this.#about.action(item.action) ||
      this.#homePage.action(item.action) ||
      this.#addonsPage.action(item.action) ||
      this.#homeApps.action(item.action) ||
      this.#search.action(item.action, this.#source) ||
      this.#show.action(item.action)
    )
      return;
    const action = actionFor(item.action);
    // Placeholder Apps until they exist.
    if (action) action(this.#actionContext());
    else this.#toast(`${item.label} is coming soon`);
  }

  /** Whether a folder's Back goes up to the Library (a Library folder, or one outside every Library folder) rather than to its parent folder. */
  #folderToLibrary(path: string): boolean {
    return (
      this.#libraryFolders.includes(path) || !this.#libraryFolders.some((f) => path.startsWith(f))
    );
  }

  /** What Back does now, named: the one place that decides, for the back link's label and for Back itself. */
  #backStep(): { label?: string; act: () => void } | undefined {
    const view = this.#state.view;
    if (this.#state.typingBy === "screen")
      return { label: "Stop typing", act: () => this.#type({ command: "typeCancel" }, "screen") };
    const front = this.#front();
    if (front) {
      return {
        act: () => {
          if (front.back() !== "leave") return;
          this.#ask(
            `Leave ${front.label}?`,
            ["Stay", "Go to Home"],
            [() => {}, () => this.#setView("home")],
          );
          this.#leaveConfirm = this.#state.confirm;
        },
      };
    }
    const go = (label: string, act: () => void) => ({ label, act });
    if (view === "folder") {
      const path = this.#state.folderPath ?? "";
      return this.#folderToLibrary(path)
        ? go(VIEW_LABELS.library, () => (this.#state.view = "library"))
        : go(basename(dirname(path)), () => this.#openFolder(dirname(path)));
    }
    if (view === "library" && this.#chip) {
      return go("All", () => {
        this.#chip = undefined;
        this.#state.focus[this.viewKey] = { r: 1, c: 0 };
      });
    }
    if (view === "settingsApps" && this.#homeApps.menuId) {
      return go(VIEW_LABELS.settingsApps, () => {
        delete this.#state.focus[APPS_MENU_KEY];
        this.#homeApps.closeMenu();
      });
    }
    if (view === "librarySearch") return go(VIEW_LABELS.library, () => this.#setView("library"));
    if (view === "show" && this.#showFrom === "librarySearch")
      return go(VIEW_LABELS.librarySearch, () => this.#setView("librarySearch"));
    if (view === "fixMatch") {
      return go(this.#show.fixBackLabel(), () => {
        this.#show.leaveFix();
        this.#keepLibraryFocus();
      });
    }
    const target = BACK_TARGETS[view];
    if (!target) return undefined;
    return go(view === "addons" ? "YouTube" : VIEW_LABELS[target], () => {
      this.#setView(target);
      this.#keepLibraryFocus();
    });
  }

  #backPayload(): Pick<ScreenPayload, "back"> {
    const label = this.#backStep()?.label;
    return label ? { back: { label } } : {};
  }

  #back(): void {
    const step = this.#backStep();
    if (step) {
      this.#cue("back");
      step.act();
    } else this.#keepLibraryFocus();
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
    if (view !== "settingsApps" && view !== "addons") {
      this.#homeApps.resetMenu();
      delete this.#state.focus[APPS_MENU_KEY];
    }
    if (from === "app") {
      if (this.#leaveConfirm && this.#state.confirm === this.#leaveConfirm) this.#dismissConfirm();
      this.#state.typingBy = undefined;
      this.#playback.delete(this.#state.app ?? "");
      this.#appTitles.flush();
      this.#appSpeed.clear(this.#state.app ?? "");
      this.#apps.get(this.#state.app ?? "")?.hide();
    }
    if (view !== "app" && view !== "appError") delete this.#state.app;
    if (view !== "appError") delete this.#state.appNote;
    this.#state.view = view;
    this.#ambient = false;
    this.#armAmbient();
    this.#releaseStrayTyping();
    if (from === "details") this.#detailsPage.cancel();
    this.#homePage.watch(view === "home" || view === "settingsHome");
    if (view === "home" || view === "settingsHome") this.#homePage.refresh(view === "settingsHome");
    if (view === "library") void this.library.refresh(this.#libraryFolders);
    if (view === "settingsRemotes") void this.refreshLoginItem();
  }

  /** The one App catalog: Home tiles, icons and Settings actions all come from it, injected Apps included. */
  #catalog(): AppEntry[] {
    const listed = this.#ports.entries ?? APP_ENTRIES;
    const extra = [...this.#apps.values()]
      .filter((a) => !listed.some((l) => l.id === a.id))
      .map((a) => ({
        id: a.id,
        label: a.label,
        icon: "",
        action: `${OPEN_APP}${a.id}`,
        web: true,
      }));
    return [...listed, ...extra];
  }

  /** What the renderer reported for Home, cut to the shown Apps in the household's order; the update icon left of the gear while an update is ready. */
  #homeBase(): GridItem[] {
    const reported = this.#grids.get("home") ?? [];
    if (reported.length === 0) return reported;
    const apps = new Map(reported.filter((i) => i.id !== "settings").map((i) => [i.id, i]));
    const ordered = this.#homeApps.shownIds().flatMap((id) => apps.get(id) ?? []);
    return [
      ...(this.#about.ready ? [UPDATE_ICON] : []),
      ...reported.filter((i) => i.id === "settings"),
      ...ordered.map((i, c) => {
        const { initial: _initial, ...item } = i;
        return { ...item, c, ...(c === 0 ? { initial: true } : {}) };
      }),
    ];
  }

  /** Home's update icon: Settings → About, with focus on Restart to update. */
  #openUpdate(): void {
    this.#setView("about");
    const cell = this.#about.restartCell();
    if (cell) this.#state.focus.about = cell;
  }

  /** Idle: nothing playing, so the Remote shows the Apps row. */
  #nothingPlaying(): boolean {
    return !this.#state.player && !this.#appNowPlaying(this.#front());
  }

  #canOpenShown(id: string): boolean {
    if (!this.#nothingPlaying() || !this.#homeApps.isShown(id)) return false;
    const inFront = this.#state.view === "app" || this.#state.view === "appError";
    return !(inFront && this.#state.app === id);
  }

  /** A Remote's quick action from any idle view: leave the place as going Home does, then open the App. */
  #openFromAnywhere(id: string): void {
    if (!this.#canOpenShown(id)) return;
    if (this.#quick.isOpen) this.#quick.close();
    this.#setView("home");
    this.#openShown(id);
  }

  /** What OK on the App's Home tile does, for a shown App only. */
  #openShown(id: string): void {
    if (!this.#homeApps.isShown(id)) return;
    const action = actionFor(this.#catalog().find((e) => e.id === id)?.action ?? "");
    if (action) action(this.#actionContext());
  }

  /** `at`: an address to open the App at (a Continue entry's title), applied to the App just before it is shown. */
  #openApp(id: string, at?: string): void {
    const app = this.#apps.get(id);
    if (!app || !this.#homeApps.isShown(id)) return;
    if (app.welcome && !this.#appsFailed.has(id)) {
      void this.#welcomeThenOpen(app, at);
      return;
    }
    this.#enterApp(id, at);
  }

  /** Asks the App's one-time question over the view we are on, and opens the App once it is answered. */
  async #welcomeThenOpen(app: App, at?: string): Promise<void> {
    const welcome = app.welcome;
    if (!welcome) return;
    const looking = this.#lookups.has(app.id);
    // Answering: a second open waits. Still looking up: the newest open takes over (the lookup is shared).
    if (this.#welcoming.has(app.id) && !looking) return;
    const lookup = ++this.#lookupSeq;
    this.#lookups.set(app.id, lookup);
    this.#welcoming.add(app.id);
    const view = this.#state.view;
    let released = false;
    const release = () => {
      if (!released) this.#welcoming.delete(app.id);
      released = true;
    };
    const question = await welcome.question().catch(() => undefined);
    if (this.#lookups.get(app.id) !== lookup) return;
    this.#lookups.delete(app.id);
    // Home, or another page, in the meantime: the household went elsewhere.
    if (this.#state.view !== view) return release();
    if (!question) {
      release();
      this.#enterApp(app.id, at);
      this.#emit();
      return;
    }
    const answer = async (id: string) => {
      this.#welcoming.add(app.id);
      const toast = await welcome.answer(id).then(
        (text) => text,
        () => `Couldn't finish that. ${app.label} is opening.`,
      );
      this.#welcoming.delete(app.id);
      if (this.#state.view !== view) return;
      this.#enterApp(app.id, at);
      if (toast) this.#toast(toast);
      this.#emit();
    };
    release();
    this.#ask(
      question.title,
      question.choices.map((c) => c.label),
      question.choices.map((c) => () => void answer(c.id)),
      { body: question.body, phone: true, back: () => void answer(question.back) },
    );
    this.#emit();
  }

  /** Shows the App; with `at`, it goes to that address first, on whichever host it has by now (a welcome can switch engines). */
  #enterApp(id: string, at?: string): void {
    const app = this.#apps.get(id);
    if (!app) return;
    this.#state.app = id;
    if (this.#appsFailed.has(id)) {
      this.#state.appNote = this.#appsFailed.get(id);
      this.#setView("appError");
      return;
    }
    this.#setView("app");
    if (at) app.openAt?.(at);
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

  async #refreshCouchCopy(id: string): Promise<void> {
    const copy = this.#apps.get(id)?.signIn?.copyFromCouch;
    if (!copy) return;
    const check = ++this.#couchCheck;
    const has = await availableWithin(() => copy.available());
    if (check !== this.#couchCheck) return;
    if (has === this.#couchCopy.has(id)) return;
    if (has) this.#couchCopy.add(id);
    else this.#couchCopy.delete(id);
    this.#emit();
  }

  /** Settings → Apps → Copy sign-in from Couch. The App reads Couch's Chromium engine; core only hears how it went. */
  async #copySignInFromCouch(id: string): Promise<void> {
    const app = this.#apps.get(id);
    const copy = app?.signIn?.copyFromCouch;
    if (!app || !copy) return;
    const result = await copy.copy().catch(() => ({ ok: false, reason: "failed" }) as const);
    const toast = copyFromCouchToast(app.label, result);
    if (toast) this.#toast(toast);
    this.#emit();
  }

  /** Settings → Apps → Playback: the App swaps to its other engine; the rows and notes that depend on it are redrawn. */
  async #switchPlayback(id: string): Promise<void> {
    const app = this.#apps.get(id);
    const playback = app?.playback;
    if (!app || !playback) return;
    const now = playback.current();
    const next = playback.options.find((o) => o.id !== now.id);
    if (!next) return;
    this.#couchCopy.delete(id);
    const failure = await playback.select(next.id).then(
      () => undefined,
      (e: unknown) => e,
    );
    this.#toast(
      failure === undefined
        ? `${app.label} now plays with ${next.label}`
        : failure instanceof PlaybackUnavailable
          ? failure.message
          : `Couldn't switch ${app.label}'s playback`,
    );
    this.#emit();
    void this.#refreshCouchCopy(id);
  }

  async #signOut(id: string): Promise<void> {
    const app = this.#apps.get(id);
    if (!app?.signIn) return;
    const done = await app.signIn.signOut().then(
      () => true,
      () => false,
    );
    this.#toast(done ? `Signed out of ${app.label}` : `Couldn't sign out of ${app.label}`);
    this.#emit();
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
        this.#appsFailed.set(app.id, event.note);
        if (this.#state.view === "app" && front) {
          this.#state.appNote = event.note;
          this.#setView("appError");
        }
        break;
      case "key":
        this.handle({ command: event.command }, "screen");
        return;
      case "confirm":
        if (!front || !this.#state.confirm) return;
        this.handle(confirmMouseCommand(event.answer ? "click" : "hover", event.index), "screen");
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
      case "input":
        this.#appSpeed.input(app.id);
        return;
      case "playback":
        if (event.playback) {
          this.#playback.set(app.id, event.playback);
          const hint = this.#hints.get(app.id);
          if (hint && event.playback.id !== undefined && event.playback.id !== hint.id)
            this.#hints.delete(app.id);
          this.#appTitles.report(app.id, event.playback, this.#ports.clock.now());
          if (event.playback.ended && this.#pictureOffScope === `app:${app.id}`) {
            this.#state.pictureOff = false;
            this.#pictureOffScope = undefined;
          }
          this.#holdAppSpeed(app, event.playback);
        } else {
          this.#playback.delete(app.id);
          this.#appTitles.flush();
        }
        break;
      case "blocked":
        // A Continue open was cancelled for leaving the App's own sites; the App is back at its home.
        if (this.#state.view === "app" && this.#state.app === app.id) {
          this.#setView("home");
          this.#toast("Couldn't open that title");
        }
        break;
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
      const volume = on && this.#state.volumeShown ? this.#level() : undefined;
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

  /** What the volume indicator shows: nothing while muted. */
  #level(): number {
    return this.#sound.muted ? 0 : this.#state.volume;
  }

  #toggleMute(): void {
    this.#sound.toggleMute();
    this.#showVolume();
  }

  #setVolume(percent: number): void {
    const volume = Math.max(0, Math.min(100, Math.round(percent)));
    this.#state.volume = volume;
    this.#sound.setVolume(volume);
    this.#showVolume();
  }

  #showVolume(): void {
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
      openAppMenu: (id) => {
        // The row waits for a fresh answer: an old one may be stale (the cookies can be gone).
        this.#couchCopy.delete(id);
        this.#homeApps.openMenu(id);
        void this.#refreshCouchCopy(id);
      },
      openApp: (id) => this.#openApp(id),
      retryApp: () => this.#retryApp(),
      restartApp: (id) => this.#restartApp(id),
      copySignInFromCouch: (id) => void this.#copySignInFromCouch(id),
      signOut: (id) => void this.#signOut(id),
      switchPlayback: (id) => void this.#switchPlayback(id),
      toast: (text) => this.#toast(text),
      forgetAllPhones: () => this.forgetAllPhones(),
      openUpdate: () => this.#openUpdate(),
      toggleListener: () => void this.#toggleListener(),
      quit: () => this.#askQuit(),
    };
  }

  /** The card the Remote shows under an App's menu: why the other playback engine isn't offered. */
  #remoteNote(): RemoteNote | undefined {
    const id = this.#homeApps.menuId;
    const reason = id ? this.#apps.get(id)?.playback?.unavailable : undefined;
    return reason ? { title: "Playback", steps: [reason] } : undefined;
  }

  #appMenuPayload(): Pick<ScreenPayload, "appMenu"> {
    const app = this.#catalog().find((a) => a.id === this.#homeApps.menuId);
    return app
      ? {
          appMenu: {
            id: app.id,
            label: app.label,
          },
        }
      : {};
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

  async #turnListenerOn(): Promise<void> {
    await this.refreshLoginItem();
    if (!this.#loginItem.on) await this.#toggleListener();
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

  /** A toast from outside the core (start-up notices). */
  showToast(text: string): void {
    this.#toast(text);
    this.#emit();
  }

  #toast(text: string): void {
    this.#cancelToast?.();
    this.#toastId++;
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
      this.#homePage.tick(this.#state.view === "home");
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

  /** What is playing in the front, for Picture off to belong to: the Library's video or one App's. */
  #pictureScope(): string | undefined {
    const s = this.#state;
    if (s.view === "player" && s.player) return "library";
    const report = s.view === "app" && s.app ? this.#playback.get(s.app) : undefined;
    if (report && !report.ended) return `app:${s.app}`;
    return undefined;
  }

  #setPictureOff(on: boolean): void {
    const scope = this.#pictureScope();
    this.#state.pictureOff = on && scope !== undefined;
    this.#pictureOffScope = this.#state.pictureOff ? scope : undefined;
  }

  /** Picture off ends by itself when playback ends, on Home, or when the App changes. */
  #syncPictureOff(): void {
    if (this.#state.pictureOff && this.#pictureScope() !== this.#pictureOffScope)
      this.#state.pictureOff = false;
  }

  #emit(): void {
    this.#syncPictureOff();
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
