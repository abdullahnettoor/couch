import { safeEqual } from "../constant-time.ts";
import type { ListenerProbe } from "../listener.ts";
import { dirname, basename } from "node:path";
import {
  VIEW_LABELS,
  type LibraryEntry,
  type Command,
  type GridItem,
  type RemoteId,
  type RemoteSnapshot,
  type ScreenPayload,
  type ScreenState,
  type View,
  type UiSound,
  type UiSoundEvent,
} from "../../shared/protocol.ts";
import {
  formatTime,
  type Player,
  type PlayerEvent,
  type PlayerTrack,
} from "../../shared/player.ts";
import type { Clock } from "../ports/clock.ts";
import type { Mac } from "../ports/mac.ts";
import { pickTargetDisplay } from "../display.ts";
import { APP_ENTRIES, OPEN_APP, type AppEntry } from "../apps/index.ts";
import {
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
import { actionFor, type ActionContext } from "./actions.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import { MediaLibrary } from "./media-library.ts";
import { artFor, type PathArt } from "./art.ts";
import { topGenres } from "./library-rows.ts";
import { presentation, hueFor, listFolder } from "./library.ts";
import { applyEdit, type TextEdit } from "../../shared/keyboard.ts";
import type { TrackList, UpNextItem } from "../../shared/protocol.ts";
import { LibraryFolders } from "./library-folders.ts";
import { ListenerLogin } from "./listener-login.ts";
import { PlayerPage } from "./pages/player-page.ts";
import { HomeScreenPage } from "./pages/home-screen-page.ts";
import { AppErrorPage, AppOverlays, AppPage } from "./pages/app-pages.ts";
import { History } from "./history.ts";
import { ContinueApps } from "./continue-apps.ts";
import { ContinueArt, type ArtFetch } from "./continue-art.ts";
import { ShowView } from "./pages/show-view.ts";
import { LibraryPage } from "./pages/library-page.ts";
import { AddonsPage } from "./pages/addons-page.ts";
import type { AppContext, FolderContext, Page, PageContext, ShowContext } from "./pages/page.ts";
import { HomeApps, leavesOnHide } from "./home-apps.ts";
import { DetailsPage } from "./pages/details-page.ts";
import {
  AddPhonePage,
  CreditsPage,
  LibraryFoldersPage,
  LibrarySettingsPage,
  RemotesPage,
  SettingsPage,
} from "./pages/settings-pages.ts";
import { SoundOutputPage } from "./pages/sound-output-page.ts";
import { SettingsHomePage } from "./pages/settings-home-page.ts";
import { SettingsAppsPage } from "./pages/settings-apps-page.ts";
import { AboutPage } from "./pages/about-page.ts";
import type { Updates } from "../ports/updates.ts";
import { HomePage } from "./home-page.ts";
import type { WallpaperPorts } from "../ports/pictures.ts";
import { SoundOutput } from "./sound-output.ts";
import { InterfaceSounds } from "./interface-sounds.ts";
import { QuickSettings } from "./quick-settings.ts";
import { Setup } from "./setup.ts";
import type { SetupStep } from "./setup-steps.ts";
import { LibrarySearchPage } from "./pages/library-search-page.ts";
import { AMBIENT_MS } from "./home-view.ts";
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
  #confirmAnswers: Array<() => void> | undefined;
  /** What Back does for the open question, when it isn't "dismiss" (the welcome's Back is an answer). */
  #confirmBack: (() => void) | undefined;
  #appsOff: Array<() => void> = [];
  #folders: LibraryFolders;
  /** Where the playing video was started from; leaving playback returns there. */
  #playedFrom: View = "folder";
  #mpvMissing = false;
  #cancelVolume: (() => void) | undefined;
  #subtitlesRaised = "falsefalse";
  #unsubPlayer: () => void;
  #thumbs: ThumbnailScheduler;
  #player: PlayerPage;
  #login: ListenerLogin;
  #home: HomeScreenPage;
  #app: AppPage;
  #overlays: AppOverlays;
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
  #settingsApps: SettingsAppsPage;
  /** The Pages by view: every View has one. */
  #pages: Record<View, Page>;
  #homePage: HomePage;
  #homeApps: HomeApps;
  #sound: SoundOutput;
  #uiSounds: InterfaceSounds;
  #quick: QuickSettings;
  #setup: Setup;
  #search: LibrarySearchPage;
  #libraryPage: LibraryPage;
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
    this.#login = new ListenerLogin({
      mac: ports.mac,
      store: ports.store,
      probe: ports.listenerProbe,
      frontdoor: ports.frontdoor,
      changed: () => this.#emit(),
    });
    void this.#login.refresh();
    this.#thumbs = new ThumbnailScheduler(ports.thumbnails, () => this.#emit());
    // Every Page gets its own context: the focus keys it owns, and only the state capabilities it needs.
    const contextFor = (...own: string[]): PageContext => {
      const check = (key: string) => {
        if (!own.some((k) => key === k || key.startsWith(`${k}:`)))
          throw new Error(`Focus key "${key}" belongs to another Page`);
        return key;
      };
      return {
        state: this.#state,
        focusOf: (key) => this.#state.focus[check(key)],
        setFocus: (key, at) => {
          if (at) this.#state.focus[check(key)] = at;
          else delete this.#state.focus[check(key)];
        },
        viewKey: () => this.viewKey,
        startTyping: (by, purpose) => {
          this.#state.typingBy = by;
          this.#typingFor = purpose;
        },
        stopTyping: () => {
          this.#state.typingBy = undefined;
        },
        go: (view, options) => this.#setView(view, options),
        toast: (text) => this.#toast(text),
        ask: (title, buttons, answers, more) => this.#ask(title, buttons, answers, more),
        cue: (sound) => this.#cue(sound),
        emit: () => this.#emit(),
      };
    };
    const pageContext = contextFor();
    const showContext: ShowContext = {
      ...contextFor("show", "fixMatch"),
      setShow: (id) => void (this.#state.showId = id),
      setShowTab: (tab) => void (this.#state.showTab = tab),
    };
    const libraryContext: FolderContext = {
      ...contextFor("library", "folder"),
      setFolder: (path) => void (this.#state.folderPath = path),
    };
    const appContext: AppContext = {
      ...contextFor(),
      setApp: (id, note) => {
        if (id === undefined) delete this.#state.app;
        else this.#state.app = id;
        if (note === undefined) delete this.#state.appNote;
        else this.#state.appNote = note;
      },
    };
    this.#show = new ShowView(showContext, {
      library: this.library,
      history: this.#history,
      details: this.details,
      thumbs: this.#thumbs,
      art: (path) => this.#art(path),
      grid: () => this.#currentGrid(),
      focusedEntry: () => this.#libraryPage.focusedEntry(),
      play: (path, fromStart) => this.#play(path, fromStart),
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
      openSettings: () => this.#leavePlaybackFor("settings"),
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
        if (leavesOnHide(id, this.#state.view, this.#state.app)) this.#leavePlaybackFor("home");
      },
      playback: (id) => {
        const playback = this.#apps.get(id)?.playback;
        return playback && { label: playback.current().label, unavailable: playback.unavailable };
      },
      hasSignIn: (id) => !!this.#apps.get(id)?.signIn,
      hasCouchCopy: (id) => this.#settingsApps.hasCouchCopy(id),
      changed: () => {
        this.#settingsApps.changed();
        this.#emit();
      },
    });
    this.#addonsPage = new AddonsPage(pageContext, {
      store: ports.store,
      apply: (app, ids, note) => this.#apps.get(app)?.setAddons?.(ids, note),
      isFront: (app) => this.#front()?.id === app,
      forgetMenu: () => this.#settingsApps.forgetMenu(),
    });
    this.#about = new AboutPage(pageContext, {
      updates: ports.updates,
      restart: () => {
        this.savePlayingPosition();
        ports.updates.restart();
      },
      runSetup: () => {
        this.#setView("home");
        this.#setup.rerun();
      },
    });
    this.#offUpdates = ports.updates.onChange(() => this.#emit());
    this.#detailsPage = new DetailsPage(pageContext, {
      details: this.details,
      connectedPhone: () =>
        this.#lastFrom !== undefined && this.#remotes.has(this.#lastFrom)
          ? this.#lastFrom
          : undefined,
    });
    this.#search = new LibrarySearchPage(contextFor("librarySearch"), {
      library: this.library,
      history: this.#history,
      details: (id) => this.details.detailsFor(id),
      dataVersion: () => this.#dataVersion,
      thumbs: this.#thumbs,
      clock: ports.clock,
      changed: () => this.#emit(),
      decorate: (e) => this.#history.decorate(e),
      connectedPhone: () =>
        this.#lastFrom !== undefined && this.#remotes.has(this.#lastFrom)
          ? this.#lastFrom
          : undefined,
    });
    this.#libraryPage = new LibraryPage(libraryContext, {
      library: this.library,
      details: this.details,
      history: this.#history,
      thumbs: this.#thumbs,
      decorate: (e) => this.#history.decorate(e),
      continueEntries: () => this.#home.libraryEntries(),
      folders: () => this.#folders.list,
      playContinue: (path, fromStart) => this.#home.playContinue(path, fromStart),
      openShow: (id) => this.#show.open(id),
      openSearch: () => {
        this.#search.open();
        if (this.#source === "screen") this.#search.action("search:field", "screen");
      },
    });
    const settingsHost = { details: this.details, sound: this.#sound };
    this.#settingsApps = new SettingsAppsPage(contextFor("settingsApps"), {
      homeApps: this.#homeApps,
      apps: this.#apps,
      clearFailure: (id) => this.#app.failed.delete(id),
      catalog: () => this.#catalog(),
      addons: () => this.#addonsPage.rows(),
    });
    this.#home = new HomeScreenPage(contextFor("home"), {
      catalog: () => this.#catalog(),
      apps: this.#apps,
      homeApps: this.#homeApps,
      history: this.#history,
      appTitles: this.#appTitles,
      continueArt: this.#continueArt,
      thumbs: this.#thumbs,
      updateReady: () => this.#about.ready,
      art: (path) => this.#art(path),
      still: (path, frame) => this.#still(path, frame),
      decorate: (e) => this.#history.decorate(e),
      resetChip: () => this.#libraryPage.resetChip(),
      fixTargetFor: (entry) => this.#show.fixTargetFor(entry),
      openFixFromHome: (id) => this.#show.openFixFromHome(id),
      watchWallpapers: (on) => this.#homePage.watch(on),
      refreshWallpapers: () => this.#homePage.refresh(false),
      setHint: (app, hint) => this.setNowPlayingHint(app, hint),
      openApp: (id, at) => this.#app.open(id, at),
      play: (path, fromStart) => this.#play(path, fromStart),
    });
    this.#player = new PlayerPage(contextFor("player"), {
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
      stopVideo: () => this.#stopPlayback(),
      endPlayback: (ended) => this.#endPlayback(undefined, ended),
      leavePlayback: () => {
        if (!this.#state.player) return;
        this.#stopPlayback();
        this.#releasePlayback(false);
      },
      changed: () => this.#emit(),
      present: (path) => this.#present(path),
      still: (path) => this.#still(path, (p) => this.#thumbs.lookup(p)),
      decorate: (e) => this.#history.decorate(e),
      level: () => this.#level(),
      resumeNote: () => this.#resumeNote,
    });
    this.#app = new AppPage(appContext, {
      apps: this.#apps,
      isShown: (id) => this.#homeApps.isShown(id),
      front: () => this.#front(),
      dismissConfirm: () => this.#dismissConfirm(),
      released: (id) => {
        this.#playback.delete(id);
        this.#appTitles.flush();
        this.#appSpeed.clear(id);
      },
    });
    this.#overlays = new AppOverlays(this.#state, {
      apps: this.#apps,
      front: () => this.#front(),
      level: () => this.#level(),
      searching: () => this.#typingFor === "search",
    });
    this.#pages = {
      home: this.#home,
      player: this.#player,
      app: this.#app,
      appError: new AppErrorPage(appContext, this.#app),
      about: this.#about,
      addons: this.#addonsPage,
      library: this.#libraryPage,
      folder: this.#libraryPage,
      librarySearch: this.#search,
      show: this.#show.page,
      fixMatch: this.#show.fixPage,
      settings: new SettingsPage(pageContext, settingsHost),
      settingsRemotes: new RemotesPage(pageContext, {
        listener: () => this.#login.item,
        refresh: () => void this.refreshLoginItem(),
      }),
      settingsLibrary: new LibrarySettingsPage(pageContext, settingsHost),
      addPhone: new AddPhonePage(pageContext),
      libraryFolders: new LibraryFoldersPage(pageContext, {
        folders: () => this.#folders.list,
        add: () => this.#folders.add(),
        remove: (folder) => this.#folders.remove(folder),
      }),
      details: this.#detailsPage,
      credits: new CreditsPage(pageContext, settingsHost),
      soundOutput: new SoundOutputPage(pageContext, {
        sound: this.#sound,
        uiSounds: this.#uiSounds,
      }),
      settingsHome: new SettingsHomePage(pageContext, this.#homePage),
      settingsApps: this.#settingsApps,
    };
    this.#folders = new LibraryFolders({
      store: ports.store,
      mac: ports.mac,
      library: this.library,
      changed: () => this.#emit(),
    });
    this.#setup = new Setup(
      {
        store: ports.store,
        apps: {
          rows: () => this.#homeApps.rows(),
          setShown: (id, shown) => void this.#homeApps.setShown(id, shown),
        },
        atHome: () => this.#state.view === "home",
        version: () => ports.updates.version,
        listenerOn: () => this.#login.item.on,
        turnListenerOn: () => void this.#login.turnOn(),
        usedBefore: () => this.#usedBefore(),
        phones: () => this.#remotes.size,
        phonePaired: () => this.#phonePaired(),
        folders: () => this.#folders.list,
        addFolder: () => this.#folders.add(),
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

  /** Couch has been used before: a phone that paired earlier, Library folders, or watch history (Library or Continue watching for Apps). */
  #usedBefore(): boolean {
    const store = this.#ports.store;
    const some = (v: unknown) =>
      typeof v === "object" && v !== null && Object.keys(v as object).length > 0;
    return (
      this.#phonePaired() ||
      some(store.read<{ folders?: unknown }>("library", {}).folders) ||
      some(store.read<{ items?: unknown }>("history", {}).items) ||
      some(store.read<{ items?: unknown }>("continue-apps", {}).items)
    );
  }

  /** A phone has paired at some point; the pairing record only exists from the first start, so it alone says nothing. */
  #phonePaired(): boolean {
    return this.#ports.store.read<{ phonesPaired?: unknown }>("pairing", {}).phonesPaired === true;
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
    const key = this.#pages[view].focusKey?.();
    if (key) return key;
    return view === "folder" ? `folder:${folderPath}` : view;
  }

  #ambient = false;
  #cancelAmbient: (() => void) | undefined;
  #timeFormat: TimeFormat = "12";
  #offTimeFormat: (() => void) | undefined;

  #keepLibraryFocus(): void {
    this.#libraryPage.keepFocus();
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

  #currentGrid(): GridItem[] {
    return this.#pages[this.#state.view].grid();
  }

  /** Start a Library video full screen, resuming where it was left. */
  #play(path: string, fromStart = false): void {
    if (this.#mpvMissing) return this.#toast(MPV_MISSING);
    // Continue watching (Home or the Library row) returns there, not into the video's folder.
    const switching = this.#state.view === "player";
    if (switching) this.savePlayingPosition();
    else this.#playedFrom = this.#state.view === "folder" ? "folder" : this.#state.view;
    if (this.#playedFrom === "folder") this.#libraryPage.focusEntry(path);
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
    const startSeconds = fromStart ? undefined : this.#history.resumeAt(path);
    this.#state.player = { path, pos: startSeconds ?? 0, dur: 0, paused: false };
    this.#tracks = { subtitles: [], audio: [] };
    if (this.#speed !== 1) {
      this.#speed = 1;
      this.#quiet(this.#ports.player.setSpeed(1));
    }
    this.#setView("player");
    this.#player.begin(upNext, show?.name);
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

  /** Lets the video go: saves where it was and resets the controls, with focus put back on what played. Never changes view. */
  #releasePlayback(ended: boolean): void {
    const p = this.#state.player;
    if (!p) return;
    this.#cancelSaves?.();
    this.#cancelSaves = undefined;
    this.#cancelNote?.();
    this.#resumeNote = undefined;
    this.#history.save(p.path, p.pos, p.dur, this.#ports.clock.now(), ended);
    this.#state.player = undefined;
    this.#player.end();
    if (this.#playedFrom === "folder") this.#libraryPage.focusEntry(p.path, ended);
    else if (this.#playedFrom === "show" && this.#state.showId)
      this.#show.focusPlayed(p.path, ended);
  }

  /** Leave playback for where it started, saving the position first. */
  #endPlayback(toast?: string, ended = false): void {
    const p = this.#state.player;
    if (!p) return;
    const from = this.#playedFrom;
    this.#releasePlayback(ended);
    if (from === "folder") {
      this.#setView(this.#state.folderPath ? "folder" : "library", { returning: true });
    } else if (from === "show" && this.#state.showId) {
      this.#show.returnTo();
    } else {
      this.#setView(from === "show" ? "library" : from, { returning: true });
      if (this.#state.view === "home") this.#home.focusCard(p.path);
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
          this.#player.show();
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
    if (!p || !this.#player.offerNext()) return this.#endPlayback(undefined, true);
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
    return this.#player.upNext.map((e) => {
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

  /** Everything the Screen renderer needs to draw. */
  screen(): ScreenPayload {
    this.#libraryPage.sync();
    const grid = this.#currentGrid();
    const focused = resolveFocus(grid, this.#state.focus[this.viewKey]);
    const homeVideos = this.#home.continueRow();
    const quick = this.#quick.payload();
    const setup = this.#setup.payload();
    return {
      ...(quick ? { quick } : {}),
      ...(setup ? { setup } : {}),
      playing: this.#pictureScope() !== undefined,
      muted: this.#sound.muted,
      ...this.#backPayload(),
      homeApps: this.#homeApps.rows(),
      home: this.#homePage.payload(),
      ...this.#pages[this.#state.view].payload(focused?.id),
      continueCard: this.#home.entries()[0],
      homeVideos,
      ambient: this.#ambient,
      timeFormat: this.#timeFormat,
      ...(this.#state.typingBy === "screen" && this.#typingFor
        ? { screenTyping: this.#typingFor }
        : {}),
      state: { ...structuredClone(this.#state), controls: this.#player.mode },
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
    const card = s.view === "home" ? this.#home.entries()[0] : undefined;
    const searchable = SEARCH_FROM.includes(s.view);
    const front = this.#front();
    const searching = s.typingBy === remote && this.#typingFor === "librarySearch";
    const setup = this.#setup.payload();
    return {
      type: "snapshot",
      where:
        this.#libraryPage.chipLine() ??
        (s.view === "folder"
          ? basename(s.folderPath ?? "")
          : s.view === "show"
            ? (this.library.show(s.showId ?? "")?.name ?? VIEW_LABELS.show)
            : s.view === "app" || s.view === "appError"
              ? (this.#apps.get(s.app ?? "")?.label ?? VIEW_LABELS[s.view])
              : VIEW_LABELS[s.view]),
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
                    ...this.#home.artKey(card.path),
                    app: { id: card.app.id, label: card.app.label, icon: card.app.icon },
                  }
                : this.#thumbKey(card.path)
                  ? { thumbKey: this.#thumbKey(card.path) }
                  : {}),
            },
          }
        : {}),
      ...(this.#player.mode === "next" && this.#player.next
        ? {
            next: {
              ...this.#present(this.#player.next.path),
              ...(this.#thumbKey(this.#player.next.path)
                ? { thumbKey: this.#thumbKey(this.#player.next.path) }
                : {}),
            },
          }
        : {}),
      ...(this.#about.ready ? { updateReady: true as const } : {}),
      ...(s.confirm ? { confirm: s.confirm } : {}),
      ...(s.toast ? { toast: { text: s.toast, id: this.#toastId } } : {}),
      ...(s.view === "settingsApps" && this.#homeApps.menuId && this.#settingsApps.remoteNote()
        ? { playbackNote: this.#settingsApps.remoteNote() }
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
            active: this.#player.mode !== "next",
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
      ...(s.player && this.#player.upNextAvailable ? { upNext: this.#upNextItems() } : {}),
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
    if (!this.#phonePaired())
      this.#ports.store.write("pairing", { key: this.#key, phonesPaired: true });
    this.#setup.phoneConnected();
    this.#emit();
  }

  disconnect(remote: RemoteId): void {
    if (!this.#remotes.delete(remote)) return;
    this.#state.remotes = this.#remotes.size;
    if (this.#state.typingBy === remote) this.#state.typingBy = undefined;
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
    if (this.#setup.isOpen && this.#confirmCommand(command)) return;
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
    if (this.#state.player && this.#player.command(command)) {
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
        if (!this.#home.menu()) this.#show.menu();
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
        const newest = this.#home.entries()[0];
        if (!newest) break;
        this.#setView("home");
        this.#home.playContinue(newest.path);
        break;
      }
      case "forgetContinue":
        this.#home.forget(command.args?.entry ?? this.#home.entries()[0]?.path);
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
    this.#player.dispose();
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
    const page = this.#pages[this.#state.view];
    if (page.press?.(direction)) return;
    if (!current) return;
    if (page.move) {
      page.move(direction);
    } else {
      const next = moveFocus(grid, current, direction);
      this.#state.focus[this.viewKey] = { r: next.r, c: next.c };
    }
    // Focus that stays put met the edge of its row or page.
    const after = resolveFocus(grid, this.#state.focus[this.viewKey]);
    this.#cue(after?.id === current.id ? "blocked" : "move");
  }

  #focusAt(r?: number, c?: number): void {
    if (this.#pages[this.#state.view].pointable?.() === false) return;
    const item = this.#currentGrid().find((i) => i.r === r && i.c === c);
    if (!item) return;
    this.#state.focus[this.viewKey] = { r: item.r, c: item.c };
    this.#show.syncTab();
    this.#player.cardActivity();
    this.#emit();
  }

  #ok(): void {
    if (this.#pages[this.#state.view].press?.("ok")) return;
    const grid = this.#currentGrid();
    const item = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!item) return;
    this.#cue("select");
    if (item.action === "back") return this.#back();
    if (this.#pages[this.#state.view].action(item.action, this.#source)) return;
    if (this.#libraryPage.action(item.action)) return;
    const action = actionFor(item.action);
    // Placeholder Apps until they exist.
    if (action) action(this.#actionContext());
    else this.#toast(`${item.label} is coming soon`);
  }

  /** What Back does now, named: the one place that decides, for the back link's label and for Back itself. */
  #backStep(): { label?: string; act: () => void } | undefined {
    const view = this.#state.view;
    if (this.#state.typingBy === "screen")
      return { label: "Stop typing", act: () => this.#type({ command: "typeCancel" }, "screen") };
    const back = this.#pages[view].back();
    if (!back) return undefined;
    return { ...(back.label ? { label: back.label } : {}), act: () => back.act() };
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

  /** Opens `view`; the player Page stops what is playing (saving its position) as the view leaves it. */
  #leavePlaybackFor(view: View): void {
    this.#setView(view);
  }

  /** Changes view: the Pages leave and enter, and the idle timers restart (not when `returning` to where the household was). */
  #setView(view: View, options?: { returning?: true }): void {
    const from = this.#state.view;
    if (from === view) return this.#pages[view].reenter?.();
    this.#state.view = view;
    this.#ambient = false;
    if (!options?.returning) this.#armAmbient();
    this.#releaseStrayTyping();
    this.#pages[from].leave?.(view);
    this.#pages[view].enter?.(from, options?.returning === true);
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

  #onApp(app: App, event: AppEvent): void {
    const front = this.#state.app === app.id;
    switch (event.type) {
      case "loaded":
        this.#app.failed.delete(app.id);
        break;
      case "failed":
        this.#app.failed.set(app.id, event.note);
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
      openApp: (id) => this.#app.open(id),
      toast: (text) => this.#toast(text),
      forgetAllPhones: () => this.forgetAllPhones(),
      openUpdate: () => this.#openUpdate(),
      toggleListener: () => void this.#login.toggle(),
      quit: () => this.#askQuit(),
    };
  }

  /** Reads the login item and whether a listener is really up from the Mac. */
  refreshLoginItem(): Promise<void> {
    return this.#login.refresh();
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
      this.#player.mode !== "hidden" &&
      this.#player.mode !== "next" &&
      this.#state.player !== undefined;
    const level = `${raised}${this.#player.mode === "upnext"}`;
    if (level !== this.#subtitlesRaised) {
      this.#subtitlesRaised = level;
      this.#ports.player.setSubtitlesRaised(raised, this.#player.mode === "upnext");
    }
    this.#syncDisplayAwake();
    this.#overlays.sync();
    this.#syncCapture();
    for (const l of [...this.#listeners]) l();
  }
}
