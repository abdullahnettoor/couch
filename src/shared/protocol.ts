import type { TimeFormat } from "./clock-format.ts";
/** Remote protocol and the state shapes shared by the core, the Remote page and the Screen renderer. */
import type { PlayerOverlay } from "./player.ts";

export type RemoteId = string;

export type View =
  | "home"
  | "youtube"
  | "youtubeError"
  | "library"
  | "folder"
  | "player"
  | "settings"
  | "addPhone"
  | "libraryFolders"
  | "details"
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
  "volSet",
  "playUpNext",
  "playNext",
  "typeOpen",
  "typeText",
  "typeSubmit",
  "typeCancel",
  "menu",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** Commands only the Screen itself may send (mouse hover). Never in COMMAND_NAMES, so Remotes can't. */
export type ScreenOnlyCommandName = "focusAt" | "showControls" | "find" | "screenKey";

export interface CommandArgs {
  /** focusAt: the grid cell to focus */
  r?: number;
  c?: number;
  /** seekBy (±) and seekTo */
  seconds?: number;
  /** volSet: 0-100 (clamped) */
  percent?: number;
  /** playUpNext: position in the Up next list */
  index?: number;
  /** typeText: the whole current text; typeOpen and screenKey (Screen only): the first character */
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

export interface ScreenState {
  view: View;
  /** Focused cell per view key, e.g. "home" or "folder:<path>". */
  focus: Record<string, { r: number; c: number }>;
  folderPath?: string;
  /** The open show page's show id, and its selected tab ("1", "2", … or "extras"). */
  showId?: string;
  showTab?: string;
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
  toast?: string;
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

/** Core → Screen renderer. */
export interface ScreenPayload {
  state: ScreenState;
  viewKey: string;
  grid: GridItem[];
  focusedId?: string;
  focusedLabel?: string;
  /** Settings and its "Show and film details" page: the TMDB key label, On/Off and any hint. */
  details?: { keyLabel: string; hasOwnKey: boolean; enabled: boolean; hint?: string };
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
export type RemoteLayout = "home" | "youtube" | "player" | "librarySearch" | "other";

/** Home's Continue watching shortcut on the Remote. */
export interface RemoteContinueCard {
  title: string;
  /** e.g. "38 min left" */
  left: string;
  /** Cache key of the video's picture, when one exists (not a path). */
  thumbKey?: string;
}

/** Mac → every phone: sent whole after every change. */
export interface RemoteSnapshot {
  type: "snapshot";
  /** Where the Screen is, e.g. "Home". */
  where: string;
  view: View;
  layout: RemoteLayout;
  /** Home only, when a video is in progress. */
  continueCard?: RemoteContinueCard;
  typeAvailable: boolean;
  /** A show or film tile is focused and details are on: the phone offers Fix match (command `menu`). */
  fixAvailable?: boolean;
  /** The Type button's label when it isn't YouTube search. */
  typeLabel?: string;
  /** The typing sheet's placeholder, when it isn't YouTube search. */
  typePlaceholder?: string;
  /** The text the typing sheet starts with (the Library search keeps its query). */
  typeSeed?: string;
  /** "other": another phone is typing; "screen": the Mac keyboard is. */
  typing: "none" | "you" | "other" | "screen";
  /** The end-of-video card: the next video in the folder, waiting for a Play press. */
  next?: { title: string; line?: string; thumbKey?: string };
  nowPlaying?: {
    title: string;
    line?: string;
    folder: string;
    position: number;
    duration: number;
    paused: boolean;
    subtitlesOn: boolean;
    /** "Animation · Comedy": up to three genres, when details have them. */
    genres?: string;
  };
  /** The playing Library video's folder, while a video plays (and has company). */
  upNext?: UpNextItem[];
  /** The Remote shows its volume −/+ pair (YouTube). */
  showVolume: boolean;
  /** The Remote shows its −10 s / +10 s pair (YouTube). */
  showSkip: boolean;
  volume: number;
  remotes: number;
}

export const VIEW_LABELS: Record<View, string> = {
  home: "Home",
  youtube: "YouTube",
  youtubeError: "YouTube",
  library: "Library",
  folder: "Library",
  player: "Now Playing",
  settings: "Settings",
  addPhone: "Add a phone",
  libraryFolders: "Library folders",
  details: "Show and film details",
  credits: "Credits",
  show: "Show",
  fixMatch: "Fix match",
  librarySearch: "Search",
};
