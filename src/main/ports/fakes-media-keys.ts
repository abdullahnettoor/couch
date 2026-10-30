import type { MediaCommand, NowPlayingInfo, RemoteCommands } from "../media-keys.ts";

/** Stands in for the Mac's remote command centre: records what Couch registers and publishes, and presses keys. */
export class FakeRemoteCommands implements RemoteCommands {
  registered = false;
  info: NowPlayingInfo | undefined;
  readonly log: string[] = [];
  #on: ((command: MediaCommand) => void) | undefined;
  start(on: (command: MediaCommand) => void): void {
    this.registered = true;
    this.#on = on;
    this.log.push("start");
  }
  setInfo(info: NowPlayingInfo): void {
    this.info = info;
    this.log.push("info");
  }
  stop(): void {
    this.registered = false;
    this.info = undefined;
    this.#on = undefined;
    this.log.push("stop");
  }
  /** A key press; ignored (like the Mac) once Couch has released the commands. */
  press(command: MediaCommand): void {
    this.#on?.(command);
  }
}
