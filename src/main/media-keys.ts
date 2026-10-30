import type { Command, RemoteId, RemoteSnapshot } from "../shared/protocol.ts";
import type { Source } from "./core/core.ts";

export type MediaCommand = "play" | "pause" | "toggle" | "next" | "previous";

export interface NowPlayingInfo {
  title: string;
  app: string;
  position: number;
  duration: number;
  paused: boolean;
}

/** The Mac's remote command centre (MPRemoteCommandCenter and MPNowPlayingInfoCenter): the media keys, AirPods and Control Centre. */
export interface RemoteCommands {
  /** Registers the commands and takes the Now Playing role; `on` is called for each press. */
  start(on: (command: MediaCommand) => void): void;
  setInfo(info: NowPlayingInfo): void;
  /** Unregisters the commands and clears Now Playing, so the keys go back to other apps. */
  stop(): void;
}

interface CoreLike {
  snapshot(remote: RemoteId): RemoteSnapshot;
  handle(command: Command, from: Source): void;
  onChange(listener: () => void): () => void;
}

/** The same step as the phone's −10 / +10 buttons. */
const SEEK_SECONDS = 10;
/** The Mac extrapolates the position itself; a bigger gap than this is a seek. */
const DRIFT_SECONDS = 2;

/**
 * Couch is the Mac's Now Playing app only while something plays: the keys then drive the core like the Remote does
 * (play/pause and a 10 s seek), and when playback stops the commands are released.
 */
export class MediaKeys {
  #core: CoreLike;
  #center: RemoteCommands;
  #published: NowPlayingInfo | undefined;
  #publishedAt = 0;
  #clock: () => number;
  #unsubscribe: () => void;

  constructor(core: CoreLike, center: RemoteCommands, now: () => number = Date.now) {
    this.#clock = now;
    this.#core = core;
    this.#center = center;
    this.#unsubscribe = core.onChange(() => this.#sync());
  }

  dispose(): void {
    this.#unsubscribe();
    this.#release();
  }

  #now(): RemoteSnapshot["nowPlaying"] {
    const np = this.#core.snapshot("media-keys").nowPlaying;
    return np?.active ? np : undefined;
  }

  #sync(): void {
    const np = this.#now();
    if (!np) return this.#release();
    const info: NowPlayingInfo = {
      title: np.title,
      app: np.app?.label ?? np.folder,
      position: np.position,
      duration: np.duration,
      paused: np.paused,
    };
    if (!this.#published) this.#center.start((command) => this.#press(command));
    else if (!this.#changed(this.#published, info)) return;
    this.#published = info;
    this.#publishedAt = this.#clock();
    this.#center.setInfo(info);
  }

  #changed(a: NowPlayingInfo, b: NowPlayingInfo): boolean {
    if (
      a.title !== b.title ||
      a.app !== b.app ||
      a.duration !== b.duration ||
      a.paused !== b.paused
    )
      return true;
    const elapsed = a.paused ? 0 : (this.#clock() - this.#publishedAt) / 1000;
    return Math.abs(b.position - (a.position + elapsed)) > DRIFT_SECONDS;
  }

  #release(): void {
    if (!this.#published) return;
    this.#published = undefined;
    this.#center.stop();
  }

  #press(command: MediaCommand): void {
    const np = this.#now();
    if (!np) return;
    const send = (c: Command) => this.#core.handle(c, "screen");
    if (
      command === "toggle" ||
      (command === "play" && np.paused) ||
      (command === "pause" && !np.paused)
    )
      send({ command: "playpause" });
    else if (command === "next") send({ command: "seekBy", args: { seconds: SEEK_SECONDS } });
    else if (command === "previous") send({ command: "seekBy", args: { seconds: -SEEK_SECONDS } });
  }
}
