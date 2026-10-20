import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadOptions, Player, PlayerEvent, PlayerOverlay } from "../../shared/player.ts";
import { overlayAss } from "./overlay.ts";
import { MpvIpcClient, type MpvEvent } from "./ipc-client.ts";

export interface EmbeddedMpv {
  setVisible(visible: boolean): void;
  destroy(): void;
}
export type EmbedFactory = (options: Record<string, string>) => EmbeddedMpv;

export interface MpvPlayerOptions {
  /** Absolute path to mpv, or undefined when it could not be found. */
  mpvPath: string | undefined;
  /** Extra mpv arguments for the spawned (headless) mpv; tests use --vo=null --ao=null. */
  extraArgs?: string[];
  /**
   * Creates an in-process mpv core drawing inside Couch's window. Without it, mpv is spawned as
   * a separate headless process (tests). Throws when libmpv can't be loaded.
   */
  embed?: EmbedFactory;
  /** Runs before each video loads. */
  beforeLoad?: () => Promise<void>;
}

/** Options for an mpv core that draws into Couch's window (embedded) or runs headless (tests). */
export function buildMpvOptions(socketPath: string): Record<string, string> {
  return {
    config: "no",
    "input-default-bindings": "no",
    "input-builtin-bindings": "no",
    idle: "yes",
    "input-ipc-server": socketPath,
    osc: "no",
    "osd-level": "0",
    hwdec: "auto",
    "keep-open": "no",
    slang: "eng,en",
    "sub-auto": "fuzzy",
  };
}

export function buildMpvArgs(socketPath: string): string[] {
  return Object.entries(buildMpvOptions(socketPath)).map(([k, v]) => `--${k}=${v}`);
}

/** One long-lived mpv core (embedded in Couch, or a child process), controlled through its local IPC socket. */
export class MpvPlayer implements Player {
  private listeners = new Set<(event: PlayerEvent) => void>();
  private child: ChildProcess | undefined;
  private embedded: EmbeddedMpv | undefined;
  private client: Promise<MpvIpcClient> | undefined;
  private dir: string | undefined;
  private disposing = false;
  /** Remembered so a listener that subscribes after start() still learns mpv is missing. */
  private missing = false;

  private options: MpvPlayerOptions;

  constructor(options: MpvPlayerOptions) {
    this.options = options;
  }

  /** Starts mpv idle. Emits `missing` when mpv isn't available, `exited` if it dies. */
  async start(): Promise<void> {
    const { mpvPath, extraArgs = [], embed } = this.options;
    if (!embed && !mpvPath) {
      this.emit({ type: "missing" });
      return;
    }
    this.dir = mkdtempSync(join(tmpdir(), "couch-mpv-"));
    const socketPath = join(this.dir, "mpv.sock");
    if (embed) {
      try {
        this.embedded = embed(buildMpvOptions(socketPath));
      } catch {
        this.cleanupDir();
        this.emit({ type: "missing" });
        return;
      }
    } else {
      const child = spawn(mpvPath!, [...buildMpvArgs(socketPath), ...extraArgs], {
        stdio: "ignore",
      });
      this.child = child;
      child.on("error", () => this.emit({ type: "missing" }));
      child.on("exit", () => {
        this.child = undefined;
        this.cleanupDir();
        if (!this.disposing) this.emit({ type: "exited" });
      });
    }
    this.client = MpvIpcClient.connect(socketPath, { timeoutMs: 8000 });
    try {
      const client = await this.client;
      client.onEvent((e) => this.onMpvEvent(e));
      await client.command(["observe_property", 1, "time-pos"]);
      await client.command(["observe_property", 2, "pause"]);
      await client.command(["observe_property", 3, "duration"]);
    } catch {
      // child exit handler reports the failure
    }
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get running(): boolean {
    return this.child !== undefined || this.embedded !== undefined;
  }

  async load(path: string, options: LoadOptions = {}): Promise<void> {
    const opts: Record<string, string> = {};
    if (options.subtitles !== undefined) opts["sub-visibility"] = options.subtitles ? "yes" : "no";
    if (options.startSeconds) opts.start = String(options.startSeconds);
    await this.options.beforeLoad?.();
    await this.send(["loadfile", path, "replace", -1, opts]);
    await this.send(["set_property", "pause", false]);
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.send(["set_property", "pause", paused]);
  }

  async seekBy(seconds: number): Promise<void> {
    await this.send(["seek", seconds, "relative"]);
  }

  async seekTo(seconds: number): Promise<void> {
    await this.send(["seek", seconds, "absolute"]);
  }

  async setSubtitles(visible: boolean): Promise<void> {
    await this.send(["set_property", "sub-visibility", visible]);
  }

  setOverlay(overlay: PlayerOverlay | undefined): void {
    const data = overlay ? overlayAss(overlay) : "";
    this.send(["osd-overlay", 1, "ass-events", data, 1920, 1080]).catch(() => {});
  }

  async getPosition(): Promise<number | undefined> {
    try {
      const value = await this.send(["get_property", "time-pos"]);
      return typeof value === "number" ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /** The video lives in Couch's window, which moves itself; nothing to do. */
  async setDisplay(_name: string | undefined): Promise<void> {}

  async stop(): Promise<void> {
    await this.send(["stop"]);
  }

  onEvent(listener: (event: PlayerEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.missing) listener({ type: "missing" });
    return () => this.listeners.delete(listener);
  }

  /** Destroys the embedded core, or quits the child and waits for it so no orphan is left. */
  async dispose(): Promise<void> {
    this.disposing = true;
    if (this.embedded) {
      (await this.client?.catch(() => undefined))?.close();
      this.embedded.destroy();
      this.embedded = undefined;
      this.cleanupDir();
      return;
    }
    const child = this.child;
    if (child) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      try {
        const client = await this.client;
        await client?.command(["quit"]).catch(() => {});
      } catch {
        // fall through to kill
      }
      const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
      await exited;
      clearTimeout(timer);
    }
    (await this.client?.catch(() => undefined))?.close();
    this.cleanupDir();
  }

  private async send(args: unknown[]): Promise<unknown> {
    if (!this.client) throw new Error("mpv is not running");
    return (await this.client).command(args);
  }

  private onMpvEvent(e: MpvEvent): void {
    if (e.event === "property-change") {
      if (typeof e.data !== "number" && typeof e.data !== "boolean") return;
      if (e.name === "time-pos" && typeof e.data === "number")
        this.emit({ type: "position", seconds: e.data });
      else if (e.name === "pause" && typeof e.data === "boolean")
        this.emit({ type: "pause", paused: e.data });
      else if (e.name === "duration" && typeof e.data === "number")
        this.emit({ type: "duration", seconds: e.data });
    } else if (e.event === "file-loaded") {
      this.embedded?.setVisible(true);
    } else if (e.event === "end-file") {
      const reason = e.reason === "eof" ? "eof" : e.reason === "error" ? "error" : "stop";
      this.embedded?.setVisible(false);
      if (e.reason === "quit") return;
      this.emit({ type: "ended", reason });
    }
  }

  private emit(event: PlayerEvent): void {
    if (event.type === "missing") this.missing = true;
    for (const listener of this.listeners) listener(event);
  }

  private cleanupDir(): void {
    if (this.dir && existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true });
    this.dir = undefined;
  }
}
