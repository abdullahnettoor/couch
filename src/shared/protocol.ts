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
  | "credits";

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
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

/** Commands only the Screen itself may send (mouse hover). Never in COMMAND_NAMES, so Remotes can't. */
export type ScreenOnlyCommandName = "focusAt" | "showControls";

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
  /** typeText: the whole current text */
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
  kind: "folder" | "video";
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
  /** Home's Continue watching card: the newest in-progress video. */
  continueCard?: LibraryEntry;
  /** Home: up to three in-progress videos, newest first. */
  homeVideos?: LibraryEntry[];
  /** Home: the in-progress video the backdrop and title show: the focused one, else the newest. */
  hero?: LibraryEntry;
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
export type RemoteLayout = "home" | "youtube" | "player" | "other";

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
  /** The Type button's label when it isn't YouTube search. */
  typeLabel?: string;
  typing: "none" | "you" | "other";
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
};
