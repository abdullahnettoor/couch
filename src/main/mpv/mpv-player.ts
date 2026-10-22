import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputDevice } from "../ports/mac.ts";
import type { GlassRect } from "../../shared/ipc.ts";
import type { LoadOptions, Player, PlayerEvent, PlayerTrack } from "../../shared/player.ts";
import { MpvIpcClient, type MpvEvent } from "./ipc-client.ts";

/** Bottom margin (mpv OSD pixels) that keeps subtitles above the overlay bar, and mpv's default. */
const RAISED_SUB_MARGIN = 110;
const UP_NEXT_SUB_MARGIN = 340;
const DEFAULT_SUB_MARGIN = 22;

export interface EmbeddedMpv {
  setVisible(visible: boolean): void;
  /** Whether native glass can be placed behind the web contents. */
  nativeGlass?: boolean;
  setGlass?(slot: number, rect: GlassRect): void;
  getColor?(): [number, number, number] | null;
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
const MAX_GLASS_SLOTS = 16;

/** The CoreAudio entries of mpv's `audio-device-list` property (`coreaudio/<UID>`, description is the name). */
export function parseAudioDeviceList(data: unknown): OutputDevice[] {
  if (!Array.isArray(data)) return [];
  const devices: OutputDevice[] = [];
  for (const d of data as Array<{ name?: unknown; description?: unknown }>) {
    if (typeof d?.name !== "string" || typeof d.description !== "string") continue;
    if (d.name.startsWith("coreaudio/"))
      devices.push({ uid: d.name.slice("coreaudio/".length), name: d.description });
  }
  return devices;
}

function languageName(code: unknown): string | undefined {
  if (typeof code !== "string" || code === "" || code === "und") return undefined;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** The audio and subtitle entries of mpv's `track-list` property, named for the phone. */
export function parseTrackList(data: unknown): { subtitles: PlayerTrack[]; audio: PlayerTrack[] } {
  const out = { subtitles: [] as PlayerTrack[], audio: [] as PlayerTrack[] };
  if (!Array.isArray(data)) return out;
  for (const t of data as Array<Record<string, unknown>>) {
    const list = t?.type === "audio" ? out.audio : t?.type === "sub" ? out.subtitles : undefined;
    if (!list || typeof t.id !== "number") continue;
    const parts = [languageName(t.lang), typeof t.title === "string" ? t.title : undefined].filter(
      (x): x is string => !!x,
    );
    list.push({
      id: String(t.id),
      label: parts.length ? parts.join(" · ") : `Track ${t.id}`,
      selected: t.selected === true,
    });
  }
  return out;
}

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
      await client.command(["observe_property", 4, "audio-device-list"]);
      await client.command(["observe_property", 5, "track-list"]);
    } catch {
      // child exit handler reports the failure
    }
  }

  get nativeGlass(): boolean {
    return this.embedded?.nativeGlass === true;
  }

  /** Native glass panels behind the web contents; slots missing from `rects` are hidden. */
  setGlass(rects: GlassRect[]): void {
    if (!this.embedded?.nativeGlass) return;
    const count = Math.min(Math.max(rects.length, this.glassSlots), MAX_GLASS_SLOTS);
    for (let slot = 0; slot < count; slot++)
      this.embedded.setGlass?.(slot, rects[slot] ?? { x: 0, y: 0, w: 0, h: 0, r: 0, alpha: 0 });
    this.glassSlots = Math.min(rects.length, MAX_GLASS_SLOTS);
  }
  private glassSlots = 0;

  /** The video's main colour (0-255 RGB), sampled by the add-on about once a second. */
  videoColor(): [number, number, number] | null {
    return this.embedded?.getColor?.() ?? null;
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

  async setTrack(kind: "subtitles" | "audio", id: string): Promise<void> {
    await this.send(["set_property", kind === "audio" ? "aid" : "sid", Number(id)]);
  }

  async setSpeed(speed: number): Promise<void> {
    await this.send(["set_property", "speed", speed]);
  }

  /** Couch's own volume: mpv's `volume`, never the Mac's. */
  async setVolume(percent: number): Promise<void> {
    await this.send(["set_property", "volume", Math.max(0, Math.min(100, percent))]);
  }

  /** `coreaudio/<UID>`, or `auto` (System default) when undefined. */
  async setAudioDevice(uid: string | undefined): Promise<void> {
    await this.send(["set_property", "audio-device", uid ? `coreaudio/${uid}` : "auto"]);
  }

  setSubtitlesRaised(raised: boolean, aboveUpNext = false): void {
    this.send([
      "set_property",
      "sub-margin-y",
      raised ? (aboveUpNext ? UP_NEXT_SUB_MARGIN : RAISED_SUB_MARGIN) : DEFAULT_SUB_MARGIN,
    ]).catch(() => {});
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

  /** The Mac's outputs as the running mpv core sees them; undefined when there is no core to ask. */
  async listAudioDevices(): Promise<OutputDevice[] | undefined> {
    try {
      return parseAudioDeviceList(await this.send(["get_property", "audio-device-list"]));
    } catch {
      return undefined;
    }
  }

  /** Calls back when mpv's core sees the list of outputs change (CoreAudio hotplug; no polling, no processes). */
  onAudioDevicesChanged(listener: () => void): () => void {
    this.audioListeners.add(listener);
    return () => this.audioListeners.delete(listener);
  }
  private audioListeners = new Set<() => void>();

  private onMpvEvent(e: MpvEvent): void {
    if (e.event === "property-change" && e.name === "audio-device-list") {
      for (const l of [...this.audioListeners]) l();
    } else if (e.event === "property-change" && e.name === "track-list") {
      this.emit({ type: "tracks", ...parseTrackList(e.data) });
    } else if (e.event === "property-change") {
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
      this.setGlass([]);
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
