import type { GridItem, SoundPayload } from "../../shared/protocol.ts";
import type { Player } from "../../shared/player.ts";
import type { Mac, OutputDevice } from "../ports/mac.ts";
import type { Store } from "../ports/store.ts";
import type { SoundSink } from "../apps/app.ts";

const DEFAULT_VOLUME = 60;
const PICK = "sound:pick:";

export interface SoundOutputHost {
  store: Store;
  mac: Mac;
  player: Player;
  /** The web Apps that play sound; mpv is the `player`. */
  sinks: SoundSink[];
  toast(text: string): void;
  changed(): void;
}

interface Saved {
  volume?: unknown;
  muted?: unknown;
  output?: unknown;
}

function isDevice(value: unknown): value is OutputDevice {
  const d = value as OutputDevice | null;
  return !!d && typeof d.uid === "string" && typeof d.name === "string";
}

/**
 * Couch's own volume and the "Sound output" setting. The volume lives here and in mpv and the
 * web Apps; the Mac's own volume and default output are never touched.
 */
export class SoundOutput {
  #h: SoundOutputHost;
  #volume: number;
  #muted: boolean;
  /** What the household chose (kept by UID and name); undefined is System default. */
  #chosen: OutputDevice | undefined;
  #devices: OutputDevice[] = [];
  #listed = false;
  /** The UID mpv is on: undefined is System default, null is "not known to be on the chosen device". */
  #mpvUid: string | undefined | null = undefined;
  #mpvPending: string | undefined | null = null;
  /** The device each part last failed to reach (so a failure is said once). */
  #mpvFailed: string | undefined;
  /** Per web App: the device it last failed to reach, and the UID it was last asked for. */
  #failed = new Map<string, string>();
  #asked = new Map<string, string | undefined>();
  #off: () => void;
  #disposed = false;

  constructor(host: SoundOutputHost) {
    this.#h = host;
    const saved = host.store.read<Saved>("sound", {});
    const volume = typeof saved.volume === "number" ? saved.volume : DEFAULT_VOLUME;
    this.#volume = Math.max(0, Math.min(100, Math.round(volume)));
    this.#muted = saved.muted === true;
    this.#chosen = isDevice(saved.output)
      ? { uid: saved.output.uid, name: saved.output.name }
      : undefined;
    this.applyVolume();
    this.#off = host.mac.onOutputDevicesChanged(() => void this.#refresh(true));
    void this.#refresh(false);
  }

  get volume(): number {
    return this.#volume;
  }

  get muted(): boolean {
    return this.#muted;
  }

  /** The name of the device in use, or undefined for System default. */
  get outputName(): string | undefined {
    return this.#effective()?.name;
  }

  /** Changing the volume unmutes. */
  setVolume(volume: number): void {
    this.#volume = volume;
    this.#muted = false;
    this.#save();
    this.applyVolume();
  }

  /** Mute remembers the level and silences everything; unmute brings it back. */
  toggleMute(): void {
    this.#muted = !this.#muted;
    this.#save();
    this.applyVolume();
  }

  /** Pushes the volume to mpv and every web App (also before each video, in case mpv restarted). */
  applyVolume(): void {
    const level = this.#muted ? 0 : this.#volume;
    this.#h.player.setVolume(level).catch(() => {});
    for (const sink of this.#h.sinks) sink.setVolume(level);
  }

  /** The chosen device when it is connected; otherwise System default. */
  #effective(): OutputDevice | undefined {
    const chosen = this.#chosen;
    return chosen && this.#devices.find((d) => d.uid === chosen.uid);
  }

  /** The chosen device is not here (only known once the list was read). */
  #missing(): boolean {
    return this.#listed && this.#chosen !== undefined && this.#effective() === undefined;
  }

  async #refresh(announce: boolean): Promise<void> {
    const devices = await this.#h.mac.listOutputDevices().catch(() => undefined);
    if (!devices || this.#disposed) return;
    const wasMissing = this.#missing();
    this.#devices = devices;
    this.#listed = true;
    const missing = this.#missing();
    if (announce && this.#chosen) {
      if (missing && !wasMissing)
        this.#h.toast(`${this.#chosen.name} isn't connected · using System default`);
      else if (!missing && wasMissing) this.#h.toast(`Back on ${this.#chosen.name}`);
    }
    this.#apply(true);
    this.#h.changed();
  }

  /** Points mpv and the web Apps at the effective device. `retry` asks them to look again even for the same device. */
  #apply(retry: boolean): void {
    const target = this.#effective();
    if (this.#mpvUid !== target?.uid) void this.#applyMpv(target);
    for (const sink of this.#h.sinks) {
      if (!retry && this.#asked.has(sink.id) && this.#asked.get(sink.id) === target?.uid) continue;
      this.#asked.set(sink.id, target?.uid);
      void sink
        .setOutputDevice(target?.name)
        .then((ok) => this.#sinkResult(sink, target?.name, ok))
        .catch(() => this.#sinkResult(sink, target?.name, false));
    }
  }

  async #applyMpv(target: OutputDevice | undefined): Promise<void> {
    const uid = target?.uid;
    if (this.#mpvPending === uid) return;
    this.#mpvPending = uid;
    try {
      await this.#h.player.setAudioDevice(uid);
      if (this.#disposed || this.#mpvPending !== uid) return;
      this.#mpvUid = uid;
      this.#mpvFailed = undefined;
    } catch {
      if (this.#disposed || this.#mpvPending !== uid || this.#effective()?.uid !== uid) return;
      this.#mpvUid = null;
      this.#h.player.setAudioDevice(undefined).catch(() => {});
      if (target && this.#mpvFailed !== uid) {
        this.#mpvFailed = uid;
        this.#h.toast(`Can't play to ${target.name} · using System default`);
        this.#h.changed();
      }
    } finally {
      if (this.#mpvPending === uid) this.#mpvPending = null;
    }
  }

  /** A web App reports whether it found the output named `name` (also called when it looks again later). */
  appOutput(id: string, name: string | undefined, ok: boolean): void {
    const sink = this.#h.sinks.find((s) => s.id === id);
    if (sink) this.#sinkResult(sink, name, ok);
  }

  #sinkResult(sink: SoundSink, name: string | undefined, ok: boolean): void {
    const target = this.#effective();
    if (this.#disposed || !target || target.name !== name) return;
    if (ok) {
      this.#failed.delete(sink.id);
      return;
    }
    if (this.#failed.get(sink.id) === target.uid) return;
    this.#failed.set(sink.id, target.uid);
    this.#h.toast(`${sink.label} can't play to ${target.name} · using System default`);
    this.#h.changed();
  }

  #choose(device: OutputDevice | undefined): void {
    this.#chosen = device;
    this.#save();
    this.#failed.clear();
    this.#mpvFailed = undefined;
    this.#mpvUid = null;
    this.#apply(true);
    this.#h.toast(`Sound output: ${device?.name ?? "System default"}`);
  }

  #save(): void {
    this.#h.store.write("sound", {
      volume: this.#volume,
      muted: this.#muted,
      output: this.#chosen,
    });
  }

  grid(): GridItem[] {
    const selected = this.#effective();
    const rows: Omit<GridItem, "r" | "c">[] = [
      { id: "default", label: "System default", action: `${PICK}` },
      ...this.#devices.map((d) => ({
        id: `dev:${d.uid}`,
        label: d.name,
        action: `${PICK}${d.uid}`,
      })),
    ];
    return rows.map((row, r) => ({
      ...row,
      r,
      c: 0,
      ...((selected ? row.id === `dev:${selected.uid}` : row.id === "default")
        ? { initial: true }
        : {}),
    }));
  }

  /** The one source of the row text for each App that plays to the Mac's output whatever is chosen. */
  #notes(): string[] {
    return this.#h.sinks
      .filter((s) => s.followsMacOutput)
      .map((s) => `${s.label} · Follows the Mac's output`);
  }

  payload(): SoundPayload {
    const selected = this.#effective();
    const notes = this.#notes();
    return {
      selected: selected?.uid ?? "default",
      label: selected?.name ?? "System default",
      ...(this.#missing()
        ? { hint: `${this.#chosen!.name} isn't connected · using System default` }
        : {}),
      ...(notes.length ? { notes } : {}),
    };
  }

  /** OK on a row of the Sound output page. */
  action(action: string): boolean {
    if (!action.startsWith(PICK)) return false;
    const uid = action.slice(PICK.length);
    if (!uid) this.#choose(undefined);
    else {
      const device = this.#devices.find((d) => d.uid === uid);
      if (device) this.#choose(device);
    }
    this.#h.changed();
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#off();
  }
}
