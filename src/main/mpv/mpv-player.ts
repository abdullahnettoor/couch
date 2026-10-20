import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadOptions, Player, PlayerEvent, PlayerOverlay } from "../../shared/player.ts";
import type { CommandName } from "../../shared/protocol.ts";
import { overlayAss } from "./overlay.ts";
import { MpvIpcClient, type MpvEvent } from "./ipc-client.ts";

export interface MpvPlayerOptions {
  /** Absolute path to mpv, or undefined when it could not be found. */
  mpvPath: string | undefined;
  /** Display name for mpv's --fs-screen-name (Electron's display.label). */
  screenName?: string;
  /** Extra mpv arguments (tests use --vo=null --ao=null). */
  extraArgs?: string[];
  /** Runs before each video loads; the Screen uses it to bring its Space forward. */
  beforeLoad?: () => Promise<void>;
}

/**
 * The only keys mpv's window answers to while it has focus: the Screen's keys, handed to Couch.
 * mpv's own bindings stay off so nothing (Esc, F, Q, double-click, dragging) can leave full
 * screen, move the window or quit mpv behind Couch's back.
 */
const WINDOW_KEYS: Record<string, CommandName> = {
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
  ENTER: "ok",
  KP_ENTER: "ok",
  ESC: "back",
  h: "home",
  H: "home",
  SPACE: "playpause",
};
const KEY_MESSAGE = "couch-key";

export function windowInputConf(): string {
  return Object.entries(WINDOW_KEYS)
    .map(([key, command]) => `${key} script-message ${KEY_MESSAGE} ${command}`)
    .join("\n");
}

export function buildMpvArgs(
  socketPath: string,
  screenName?: string,
  inputConf?: string,
): string[] {
  const args = [
    "--no-config",
    "--input-default-bindings=no",
    "--input-builtin-bindings=no",
    "--input-builtin-dragging=no",
    "--window-dragging=no",
    "--idle=yes",
    `--input-ipc-server=${socketPath}`,
    "--fs",
    "--no-native-fs",
    "--no-border",
    "--osc=no",
    "--osd-level=0",
    "--cursor-autohide=always",
    "--hwdec=auto",
    "--macos-app-activation-policy=accessory",
    "--keep-open=no",
    "--slang=eng,en",
    "--sub-auto=fuzzy",
  ];
  if (inputConf) args.push(`--input-conf=${inputConf}`);
  if (screenName) args.push(`--fs-screen-name=${screenName}`);
  return args;
}

/** One long-lived mpv child process, controlled only through its local IPC socket. */
export class MpvPlayer implements Player {
  private listeners = new Set<(event: PlayerEvent) => void>();
  private child: ChildProcess | undefined;
  private client: Promise<MpvIpcClient> | undefined;
  private dir: string | undefined;
  private disposing = false;
  /** Remembered so a listener that subscribes after start() still learns mpv is missing. */
  private missing = false;

  private options: MpvPlayerOptions;

  constructor(options: MpvPlayerOptions) {
    this.options = options;
  }

  /** Starts mpv idle. Emits `missing` when mpv isn't installed, `exited` if it dies. */
  async start(): Promise<void> {
    const { mpvPath, screenName, extraArgs = [] } = this.options;
    if (!mpvPath) {
      this.emit({ type: "missing" });
      return;
    }
    this.dir = mkdtempSync(join(tmpdir(), "couch-mpv-"));
    const socketPath = join(this.dir, "mpv.sock");
    const inputConf = join(this.dir, "input.conf");
    writeFileSync(inputConf, windowInputConf());
    const child = spawn(
      mpvPath,
      [...buildMpvArgs(socketPath, screenName, inputConf), ...extraArgs],
      {
        stdio: "ignore",
      },
    );
    this.child = child;
    child.on("error", () => this.emit({ type: "missing" }));
    child.on("exit", () => {
      this.child = undefined;
      this.cleanupDir();
      if (!this.disposing) this.emit({ type: "exited" });
    });
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
    return this.child !== undefined;
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

  async setDisplay(name: string | undefined): Promise<void> {
    if (!name) return;
    this.options.screenName = name;
    await this.send(["set_property", "fs-screen-name", name]);
    const fs = await this.send(["get_property", "fullscreen"]);
    if (fs === true) {
      await this.send(["set_property", "fullscreen", false]);
      await this.send(["set_property", "fullscreen", true]);
    }
  }

  async stop(): Promise<void> {
    await this.send(["stop"]);
  }

  onEvent(listener: (event: PlayerEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.missing) listener({ type: "missing" });
    return () => this.listeners.delete(listener);
  }

  /** Quits mpv and waits for the process to exit so no orphan is left behind. */
  async dispose(): Promise<void> {
    this.disposing = true;
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
    } else if (e.event === "client-message") {
      const [name, command] = Array.isArray(e.args) ? e.args : [];
      if (name === KEY_MESSAGE && Object.values(WINDOW_KEYS).includes(command))
        this.emit({ type: "key", command });
    } else if (e.event === "end-file") {
      const reason = e.reason === "eof" ? "eof" : e.reason === "error" ? "error" : "stop";
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
