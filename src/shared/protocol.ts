import type { TimeFormat } from "./clock-format.ts";
/** Remote protocol and the state shapes shared by the core, the Remote page and the Screen renderer. */
import type { PlayerOverlay } from "./player.ts";
import type { PictureTile, Slideshow, WallpaperChoice } from "./wallpapers.ts";

export type RemoteId = string;

export type View =
  | "home"
  | "app"
  | "appError"
  | "library"
  | "folder"
  | "player"
  | "settings"
  | "settingsRemotes"
  | "settingsLibrary"
  | "settingsApps"
  | "addPhone"
  | "libraryFolders"
  | "details"
  | "soundOutput"
  | "settingsHome"
  | "about"
  | "addons"
  | "credits"
  | "show"
  | "fixMatch"
  | "librarySearch";

export const COMMAND_NAMES = [
  "up",
  "down",
  "left",
  "right",
  "ok",
  "back",
  "home",
  "playpause",
  "resume",
  "volUp",
  "volDown",
  "subtitles",
  "seekBy",
  "seekTo",
  "setTrack",
  "setSpeed",
  "volSet",
  "playUpNext",
  "playNext",
  "typeOpen",
  "typeText",
  "typeSubmit",
  "typeCancel",
  "menu",
  "power",
  "toggleAddon",
  "mute",
  "setSpeed",
  "pressPrompt",
  "openSettings",
  "openUpdate",
  "setPictureOff",
  "quickSettings",
  "confirmAnswer",
  "openApp",
  "forgetContinue",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** Commands only the Screen itself may send (mouse hover). Never in COMMAND_NAMES, so Remotes can't. */
export type ScreenOnlyCommandName =
  | "focusAt"
  | "showControls"
  | "find"
  | "screenKey"
  | "confirmAt"
  | "quickEdge"
  | "quickClose"
  | "quickPick";

export type PromptId = "skipIntro" | "skipRecap" | "nextEpisode";

export type TrackKind = "subtitles" | "audio";

/** One subtitle or audio choice a web App offers; `on` marks the current one. */
export interface Track {
  id: string;
  label: string;
  /** BCP 47 language tag, when the source gives one; the Remote's chips show its short code. */
  lang?: string;
  on: boolean;
}
export type TrackList = Track[];

export interface CommandArgs {
  /** focusAt: the grid cell to focus */
  r?: number;
  c?: number;
  /** seekBy (±) and seekTo */
  seconds?: number;
  /** volSet: 0-100 (clamped) */
  percent?: number;
  /** setTrack: which list, and the track's id from the snapshot */
  kind?: TrackKind;
  track?: string;
  /** setSpeed: the playback speed (one of nowPlaying.speeds) */
  speed?: number;
  /** pressPrompt: which prompt (nowPlaying.prompt.id) */
  id?: PromptId;
  /** playUpNext: position in the Up next list; confirmAt (Screen only) and confirmAnswer (phones): the confirmation button clicked */
  index?: number;
  /** openApp: the App's id, from the snapshot's `apps` */
  app?: string;
  /** toggleAddon: the add-on's id (YouTube's add-ons) */
  addon?: string;
  /** forgetContinue: the Continue watching entry's id (its `path`); without it, the newest */
  entry?: string;
  /** setPictureOff: true hides the picture, false brings it back */
  on?: boolean;
  /** quickPick (Screen only): the id of the drawer row clicked */
  item?: string;
  /** typeText: the whole current text; confirmAnswer: the question's title the phone is answering; typeOpen and screenKey (Screen only): the first character */
  text?: string;
}

/** What a Remote (or the Screen's keyboard) asks the core to do. */
export interface Command {
  command: CommandName | ScreenOnlyCommandName;
  args?: CommandArgs;
}

/** Phone → Mac. */
export interface CommandMessage extends Command {
  type: "command";
}

export interface GridItem {
  id: string;
  r: number;
  c: number;
  label: string;
  /** Reported by the renderer; the core decides what OK on it does. */
  action: string;
  /** Focus lands here the first time the view opens. */
  initial?: boolean;
}

/** A two-button question drawn over whatever the Screen shows; `focus` is the highlighted button. */
export interface Confirmation {
  title: string;
  /** A calm line under the title (the welcome's "It needs its own sign-in."). */
  body?: string;
  /** Two or three answers; the first is where focus starts unless `focus` says otherwise. */
  buttons: string[];
  focus: number;
  /** The phone shows the same answers as buttons (the Remote's `confirmAnswer`); otherwise it answers with its pad. */
  phone?: true;
}

/** One Setup step as the Screen and a paired phone both draw it; `focus` is the highlighted button. */
export interface SetupPayload {
  /** The step's id; a phone's answer (`confirmAnswer`) names it in `text`. */
  id: string;
  title: string;
  body?: string;
  /** A small line under the step's main content (the same-Wi-Fi note, the background-item note). */
  note?: string;
  /** An instruction in words, never a button. */
  hint?: string;
  /** The quiet last line of the panel ("You can change all of this later in Settings."). */
  footnote?: string;
  /** The "You're set" tips: a key's name, drawn as a key, and what it does. */
  tips?: SetupTip[];
  /** Draw the pairing QR code (from `pairingUrl`) under the words. */
  qr?: boolean;
  /** A phone has just connected: a glowing ✓. */
  connected?: true;
  /** A list the step shows under its words, such as the Library folders already added. */
  list?: string[];
  /** Which step this is (from 0) of how many, for the dots. */
  step: number;
  steps: number;
  /** On/off App tiles above the buttons, with each App's logo; `focus` counts them first, then the buttons. */
  tiles?: SetupTilePayload[];
  /** How many tiles a row holds on the Screen; the arrows move in that grid. */
  columns?: number;
  /** At most two. */
  buttons: string[];
  focus: number;
  /** A fresh Setup (not Run setup again, not New in Couch): the Screen opens it with the intro. */
  intro?: true;
  /** The last step: the Screen gives it the warm glow, and Home comes in under it when it closes. */
  final?: true;
}

export interface SetupTip {
  key: string;
  text: string;
}

export interface SetupTilePayload {
  id: string;
  label: string;
  /** The App's logo, as SVG markup (the one Home and Settings → Apps draw). */
  icon: string;
  on: boolean;
}

export interface ScreenState {
  view: View;
  /** Focused cell per view key, e.g. "home" or "folder:<path>". */
  focus: Record<string, { r: number; c: number }>;
  folderPath?: string;
  /** The open show page's show id, and its selected tab ("1", "2", … or "extras"). */
  showId?: string;
  showTab?: string;
  /** The front web App's id, while the view is "app" or "appError". */
  app?: string;
  /** Why the front App didn't load, in words for the error screen, while the view is "appError". */
  appNote?: string;
  typingBy?: RemoteId;
  query: string;
  player?: { path: string; pos: number; dur: number; paused: boolean };
  subtitlesOn: boolean;
  /** Player controls: the dock is up, or only the video shows. */
  controls: "hidden" | "dock" | "upnext" | "next";
  volume: number;
  /** The volume level indicator is on screen. */
  volumeShown?: boolean;
  remotes: number;
  /** Picture off: a black cover over the whole Screen while playback carries on underneath. */
  pictureOff: boolean;
  toast?: string;
  confirm?: Confirmation;
}

/** A tile in the Library: a folder or a video file. */
export interface LibraryEntry {
  kind: "folder" | "video" | "show";
  /** Unique tile id when the same item can appear in several rows; defaults to `path`. For a show, `path` is its id. */
  id?: string;
  path: string;
  /** Folder name, or the cleaned file title. */
  title: string;
  /** Episodes: "Arcane · S1 E1". */
  line?: string;
  /** Plain tile colour derived from the title. */
  hue: number;
  /** Folder whose path doesn't exist (an unplugged drive). */
  missing?: boolean;
  /** URL of a frame from the video, once it has been made. */
  thumb?: string;
  /** Folders: URLs of up to four frames from videos inside, those already made. */
  mosaic?: string[];
  /** Folders: how many videos and subfolders are directly inside. */
  count?: number;
  /** Watched: past 90% or with 2 minutes or less left. */
  watched?: boolean;
  /** In progress: how far along and how long is left, e.g. "38 min left". */
  progress?: { fraction: number; left: string };
  /** Name of the folder holding the video (Continue watching). */
  folder?: string;
  /** What the Library's featured area shows while this tile is focused. */
  feature?: {
    kind: "Show" | "Film" | "Folder";
    title: string;
    sub?: string;
    /** TMDB overview (the Library shows at most three lines). */
    overview?: string;
    /** TMDB backdrop for the featured area's background. */
    backdrop?: string;
    /** Up to three TMDB genres, drawn as small labels. */
    genres?: string[];
  };
  /** Home: TMDB backdrop for the hero (the tile's `thumb` is the still or poster-sized art). */
  backdrop?: string;
  /** Home: up to three TMDB genres, drawn as small labels under the hero title. */
  genres?: string[];
  /** Home: TMDB overview under the hero title. */
  overview?: string;
  /** A Continue watching entry for a title in a web App rather than a Library video; `path` is then a made-up id, not a file. `fromStart`: its resume address carries the time, so From start can drop it (YouTube; Netflix decides itself). */
  app?: { id: string; label: string; icon: string; fromStart: boolean };
}

/** One row on the Library's first page. */
export interface LibraryRow {
  id: string;
  title: string;
  /** 2:3 posters (Shows, Films); otherwise 16:9 tiles. */
  poster?: boolean;
  entries: LibraryEntry[];
}

/** A filter chip on the Library's first page. */
export interface LibraryChip {
  /** "all", "shows", "films", "lang:<code>" or "genre:<name>". */
  key: string;
  label: string;
  active: boolean;
}

/** What the Library views draw; the core also builds their grids from it. */
export interface LibraryPayload {
  /** Heading: "Library", or the folder's name. */
  heading: string;
  entries: LibraryEntry[];
  /** Shown instead of tiles when there are none. */
  emptyText?: string;
  /** Library folders settings page: the added folder paths. */
  folders?: string[];
  /** The Library's first page: every in-progress video, newest first. */
  continueWatching?: LibraryEntry[];
  /** The Library's first page: the rows above Folders, empty ones left out. `entries` are the Folders row. */
  rows?: LibraryRow[];
  /** The Library's first page: the chip row under the featured area; empty when there is nothing to filter. */
  chips?: LibraryChip[];
  /** The Library's first page: the tile the featured area shows. The focused tile, else the last focused one, else the first. */
  featuredId?: string;
}

/** One row of the show page's episode list (or an extra). */
export interface ShowEpisode {
  /** The file path; also the grid id. */
  id: string;
  /** Episode number; absent for extras. */
  number?: number;
  title: string;
  /** TMDB overview, two lines. */
  overview?: string;
  thumb?: string;
  hue: number;
  watched?: boolean;
  progress?: { fraction: number; left: string };
  missing?: boolean;
}

/** What the show page draws: details on the left, season tabs and the episode list on the right. */
export interface ShowPagePayload {
  id: string;
  name: string;
  /** "2021", "2 seasons", "18 episodes" … */
  meta: string[];
  /** The primary button, e.g. "Resume S1 E4". */
  primary: string;
  /** The TMDB backdrop, or a frame from the episode the primary button plays. */
  backdrop?: string;
  /** Up to three TMDB genres, drawn as small labels. */
  genres?: string[];
  /** TMDB poster for the left column. */
  poster?: string;
  /** TMDB overview, four lines. */
  overview?: string;
  tabs: { id: string; label: string; selected: boolean }[];
  episodes: ShowEpisode[];
  /** Fix match is offered (details are on and a key exists). */
  canFix: boolean;
  /** Details are on and this title uses them, so the poster space is kept even before the art arrives. */
  artExpected: boolean;
}

/** Fix match: the top TMDB results for a show or film, or still loading. */
export interface FixMatchPayload {
  name: string;
  loading: boolean;
  options: { id: string; name: string; year?: number; poster?: string }[];
}

/** The Library search view: the live query and its result rows (Shows, Films, Episodes). */
export interface LibrarySearchPayload {
  query: string;
  /** Typing paused less than a moment ago: the results below are for an earlier query. */
  searching: boolean;
  /** A phone's typing sheet is open (the field shows a caret). */
  typing: boolean;
  rows: LibraryRow[];
}

/** The Sound output setting: what plays now (System default while the chosen device is missing). */
export interface SoundPayload {
  /** "default", or the UID of the device in use. */
  selected: string;
  /** "System default", or the device's name. */
  label: string;
  /** Present while the chosen device isn't connected. */
  hint?: string;
  /** One line per App that plays to the Mac's output whatever is chosen, drawn as a row that can't take focus: "Netflix · Follows the Mac's output". */
  notes?: string[];
}

/** Settings → About: the version line, and the Check for updates and Beta updates rows' values. */
export interface AboutPayload {
  /** "0.2.0 (12)", with " · Beta" while Beta updates is on. */
  version: string;
  /** Check for updates' value: where the update is ("Up to date", "Checking…", "0.2.1 is ready"…). */
  check?: string;
  beta: boolean;
  /** A calm line under the rows (a Beta updates switch that waits for the next start). */
  hint?: string;
}

/** One row (or button) of the Quick settings drawer. */
export interface QuickItem {
  id: string;
  r: number;
  c: number;
  label: string;
  /** A Sound output row: the action Settings uses for it. */
  action?: string;
  /** The Sound output in use. */
  checked?: boolean;
}

/** The Quick settings drawer, while it is open. */
export interface QuickPayload {
  items: QuickItem[];
  focusedId: string;
  volume: number;
  muted: boolean;
  /** The drawer is over video or an App (not one of Couch's own views), so its panel is more solid. */
  overMedia: boolean;
  /** The Sound output rows for Apps that follow the Mac (see `SoundPayload.notes`). */
  notes?: string[];
}

/** Core → Screen renderer. */
export interface HomePayload {
  /** The saved wallpaper ("In use"). */
  wallpaper: WallpaperChoice;
  /** Only on Settings → Home: the wallpaper in focus, shown live but not saved. */
  preview?: WallpaperChoice;
  /** The Resume artwork fades over the wallpaper. */
  artwork: boolean;
  /** The Mac's pictures after the built-ins, in tile order: Same as Mac (when the Mac has a desktop picture), the folder's, then Apple's. */
  pictures?: PictureTile[];
  /** Settings → Home: the wallpaper folder, shortened for display, and the slideshow setting. */
  folder?: string;
  slideshow?: Slideshow;
}

export interface ScreenPayload {
  /** What Back does next, named for the back link: the core's own next step, so the label and Back always agree. Absent where a page has no back link. */
  back?: { label: string };
  /** The Quick settings drawer, present while it is open. */
  quick?: QuickPayload;
  /** Setup's current step, present while Setup is open: the Screen shows only its panel over Home's wallpaper. */
  setup?: SetupPayload;
  /** A video is on screen (the Library's, or a web App's playing one), so the idle cursor hides. */
  playing: boolean;
  /** Couch is muted (the level is `state.volume`). */
  muted: boolean;
  state: ScreenState;
  viewKey: string;
  grid: GridItem[];
  focusedId?: string;
  focusedLabel?: string;
  /** Settings and its "Show and film details" page: the TMDB key label, On/Off and any hint. */
  details?: { keyLabel: string; hasOwnKey: boolean; enabled: boolean; hint?: string };
  /** Settings → Apps with the menu open: the App it is for (its row stays marked). */
  appMenu?: { id: string; label: string };
  /** What Home draws behind everything; on the Home settings page, shown with the tile in focus as `preview`. */
  home?: HomePayload;
  /** Settings and the Sound output page. */
  sound?: SoundPayload;
  /** Settings → About. */
  about?: AboutPayload;
  /** The Sound output page: whether Interface sounds is on. */
  interfaceSounds?: boolean;
  /** Settings and the YouTube add-ons page: each add-on and whether it is on. */
  addons?: Array<{ id: string; label: string; description: string; on: boolean }>;
  /** Every App with whether Home shows it, in Home order (Store key `home.apps`). */
  homeApps?: Array<{ id: string; label: string; icon: string; shown: boolean }>;
  /** Settings: the listener's login item and whether a listener is running now. */
  listener?: { available: boolean; on: boolean; running: boolean };
  /** Present for library, folder and libraryFolders. */
  library?: LibraryPayload;
  /** Present on the show page. */
  show?: ShowPagePayload;
  /** The Screen's own keyboard is typing for this purpose (never the text itself). */
  screenTyping?: "librarySearch" | "tmdbKey" | "search";
  /** Present on the Library search. */
  search?: LibrarySearchPayload;
  /** Present on the Fix match list. */
  fixMatch?: FixMatchPayload;
  /** Home's Continue watching card: the newest in-progress video. */
  continueCard?: LibraryEntry;
  /** Home: up to three in-progress videos, newest first. */
  homeVideos?: LibraryEntry[];
  /** Home: the focused (or last focused) in-progress film whose backdrop and title show; absent on the calm Home. */
  hero?: LibraryEntry;
  /** Home: the idle clock only, the App row and top strip faded away. */
  ambient?: boolean;
  /** How the Mac shows times of day. */
  timeFormat: TimeFormat;
  /** The player overlay the renderer draws over the video; present while a video plays. */
  overlay?: PlayerOverlay;
  /** What the pairing QR code encodes. */
  pairingUrl: string;
  /** Epoch ms from the Clock port, for the Home clock. */
  now: number;
}

/** The Screen's Interface sounds: focus moved, something was picked, Back left a view, or a move went nowhere. */
export type UiSound = "move" | "select" | "back" | "blocked";

/** Core → Screen renderer: one Interface sound to play, at Couch's volume (0–100), on the chosen output's name (System default when absent). */
export interface UiSoundEvent {
  sound: UiSound;
  volume: number;
  output?: string;
}

/** One video in the Up next list as a phone sees it. */
export interface UpNextItem {
  title: string;
  line?: string;
  /** Cache key of the video's picture, when one exists (not a path). */
  thumbKey?: string;
  watched: boolean;
  playing: boolean;
  /** 0–1, for a partly watched video. */
  progress?: number;
}

/** Which control layout the Remote shows. */
export type RemoteLayout = "home" | "app" | "player" | "librarySearch" | "other";

/** Home's Continue watching shortcut on the Remote. */
export interface RemoteContinueCard {
  title: string;
  /** e.g. "38 min left" */
  left: string;
  /** Cache key of the video's picture, when one exists (not a path). */
  thumbKey?: string;
  /** An App title: the App's badge (its picture, if saved, is `thumbKey`). */
  app?: { id: string; label: string; icon: string };
}

/** A short explanation the Remote shows as a card: a title and the steps to follow. */
export interface RemoteNote {
  title: string;
  steps: string[];
}

/** Mac → every phone: sent whole after every change. */
export interface RemoteSnapshot {
  type: "snapshot";
  /** Where the Screen is, e.g. "Home". */
  where: string;
  view: View;
  layout: RemoteLayout;
  /** Idle only (nothing playing): the Apps Home shows, in order, for the Remote's quick actions (command `openApp`). */
  apps?: Array<{ id: string; label: string; icon: string }>;
  /** Home only, when a video is in progress. */
  continueCard?: RemoteContinueCard;
  typeAvailable: boolean;
  /** An update has downloaded: on Home the phone shows the update icon beside the gear (command `openUpdate`). */
  updateReady?: true;
  /** Settings → Apps: why the App's other playback engine isn't offered. */
  playbackNote?: RemoteNote;
  /** The Screen's toast, mirrored: the phone shows each `id` once, calmly, whatever view it is in. */
  toast?: { text: string; id: number };
  /** A question is up on the Screen; the D-pad, OK and Back answer it. */
  confirm?: Confirmation;
  /** Setup is open: the same step and buttons as the Screen (answered with `confirmAnswer`, `text` the step's id). */
  setup?: SetupPayload;
  /** A show or film tile is focused and details are on: the phone offers Fix match (command `menu`). */
  fixAvailable?: boolean;
  /** The Type button's label when it isn't a search. */
  typeLabel?: string;
  /** The typing sheet's placeholder, when it isn't a search. */
  typePlaceholder?: string;
  /** The text the typing sheet starts with (the Library search keeps its query). */
  typeSeed?: string;
  /** "other": another phone is typing; "screen": the Mac keyboard is. */
  typing: "none" | "you" | "other" | "screen";
  /** The end-of-video card: the next video in the folder, waiting for a Play press. */
  next?: { title: string; line?: string; thumbKey?: string };
  nowPlaying?: {
    /** Playing or paused counts as active; a video at its end (a web video that ended, or the Library's next card) does not. */
    active: boolean;
    title: string;
    line?: string;
    folder: string;
    position: number;
    duration: number;
    paused: boolean;
    subtitlesOn: boolean;
    /** A web App's video: the seek bar moves the video (false: it only shows the position). */
    canSeek?: boolean;
    /** A web App's choices, when its adapter lists them. */
    subtitles?: TrackList;
    audio?: TrackList;
    /** Playback speed now, and the choices; present only when the App can change speed (command `setSpeed`). */
    speed?: number;
    speeds?: number[];
    /** A web App's picture for the title (https). */
    artwork?: string;
    /** A Library video's TMDB picture: the key the phone fetches from /thumb/ (none without art). */
    artKey?: string;
    /** "Animation · Comedy": up to three genres, when details have them. */
    genres?: string;
    /** The App playing: its logo (SVG markup from its App entry), for the no-artwork picture. */
    app?: { id: string; label: string; icon: string };
    /** A button the App offers right now (Netflix: Skip Intro, Skip Recap, Next Episode). */
    prompt?: { id: PromptId; label: string };
  };
  /** The playing Library video's folder, while a video plays (and has company). */
  upNext?: UpNextItem[];
  /** The Remote shows its volume −/+ pair (a web App). */
  showVolume: boolean;
  /** The Remote shows its −10 s / +10 s pair (a web App). */
  showSkip: boolean;
  volume: number;
  /** Couch is muted; `volume` is the level unmute restores. */
  muted: boolean;
  /** Picture off is on: the Screen shows a black cover (the phone offers "Picture on"). */
  pictureOff: boolean;
  /** The Quick settings drawer is open on the Screen (the phone shows the D-pad). */
  quickSettings: boolean;
  remotes: number;
}

export const VIEW_LABELS: Record<View, string> = {
  home: "Home",
  app: "App",
  appError: "App",
  library: "Library",
  folder: "Library",
  player: "Now Playing",
  settings: "Settings",
  settingsRemotes: "Remotes and Devices",
  settingsLibrary: "Library",
  settingsApps: "Apps",
  addPhone: "Add a phone",
  libraryFolders: "Library folders",
  details: "Show and film details",
  soundOutput: "Sound output",
  settingsHome: "Home",
  about: "About",
  addons: "YouTube add-ons",
  credits: "Credits",
  show: "Show",
  fixMatch: "Fix match",
  librarySearch: "Search",
};
