/** Remote protocol and the state shapes shared by the core, the Remote page and the Screen renderer. */

export type RemoteId = string;

export type View =
  | "home"
  | "youtube"
  | "youtubeError"
  | "library"
  | "folder"
  | "player"
  | "settings"
  | "addPhone";

export const COMMAND_NAMES = [
  "up",
  "down",
  "left",
  "right",
  "ok",
  "back",
  "home",
  "playpause",
  "volUp",
  "volDown",
  "subtitles",
  "seekBy",
  "seekTo",
  "typeOpen",
  "typeText",
  "typeSubmit",
  "typeCancel",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

export interface CommandArgs {
  /** seekBy (±) and seekTo */
  seconds?: number;
  /** typeText: the whole current text */
  text?: string;
}

/** What a Remote (or the Screen's keyboard) asks the core to do. */
export interface Command {
  command: CommandName;
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
  volume: number;
  remotes: number;
  toast?: string;
}

/** Core → Screen renderer. */
export interface ScreenPayload {
  state: ScreenState;
  viewKey: string;
  grid: GridItem[];
  focusedId?: string;
  focusedLabel?: string;
  /** Epoch ms from the Clock port, for the Home clock. */
  now: number;
}

/** Mac → every phone: sent whole after every change. */
export interface RemoteSnapshot {
  type: "snapshot";
  /** Where the Screen is, e.g. "Home". */
  where: string;
  view: View;
  typeAvailable: boolean;
  typing: "none" | "you" | "other";
  nowPlaying?: {
    title: string;
    folder: string;
    position: number;
    duration: number;
    paused: boolean;
    subtitlesOn: boolean;
  };
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
};
