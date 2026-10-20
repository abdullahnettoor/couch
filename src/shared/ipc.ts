/** Channel names and payloads between the Screen renderer and the main process. */
export const Channel = {
  /** renderer → main: a temporary keyboard command */
  command: "couch:command",
  /** main → renderer: Screen status updates */
  status: "couch:status",
} as const;

export type ScreenCommand = "play" | "togglePause" | "seekBack" | "seekForward" | "stop" | "quit";

export interface ScreenStatus {
  mpvMissing: boolean;
  playing: boolean;
  paused: boolean;
  position: number;
  message?: string;
}

export interface CouchApi {
  send(command: ScreenCommand): void;
  onStatus(listener: (status: ScreenStatus) => void): void;
}
