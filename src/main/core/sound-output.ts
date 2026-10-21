import type { GridItem, SoundPayload } from "../../shared/protocol.ts";
import type { Player } from "../../shared/player.ts";
import type { Mac, OutputDevice } from "../ports/mac.ts";
import type { Store } from "../ports/store.ts";
import type { YouTube } from "../ports/youtube.ts";

const DEFAULT_VOLUME = 60;
const PICK = "sound:pick:";

export interface SoundOutputHost {
  store: Store;
  mac: Mac;
  player: Player;
  youtube: YouTube;
  toast(text: string): void;
  changed(): void;
}

interface Saved {
  volume?: unknown;
  output?: unknown;
}

function isDevice(value: unknown): value is OutputDevice {
  const d = value as OutputDevice | null;
  return !!d && typeof d.uid === "string" && typeof d.name === "string";
}

/**
 * Couch's own volume and the "Sound output" setting. The volume lives here and in mpv and the
 * YouTube view; the Mac's own volume and default output are never touched.
 */
export class SoundOutput {
  #h: SoundOutputHost;
  #volume: number;
  /** What the household chose (kept by UID and name); undefined is System default. */
  #chosen: OutputDevice | undefined;
  #devices: OutputDevice[] = [];
  #listed = false;
  /** The device mpv and YouTube were last pointed at; undefined is System default. */
  #applied: OutputDevice | undefined;
  #off: () => void;
  #disposed = false;

  constructor(host: SoundOutputHost) {
    this.#h = host;
    const saved = host.store.read<Saved>("sound", {});
    const volume = typeof saved.volume === "number" ? saved.volume : DEFAULT_VOLUME;
    this.#volume = Math.max(0, Math.min(100, Math.round(volume)));
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

  setVolume(volume: number): void {
    this.#volume = volume;
    this.#save();
    this.applyVolume();
  }

  /** Pushes the volume to mpv and the YouTube view (also before each video, in case mpv restarted). */
  applyVolume(): void {
    this.#h.player.setVolume(this.#volume).catch(() => {});
    this.#h.youtube.setVolume(this.#volume);
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
    this.#apply();
    this.#h.changed();
  }

  #apply(): void {
    const target = this.#effective();
    if (target?.uid === this.#applied?.uid) return;
    this.#applied = target;
    this.#h.player.setAudioDevice(target?.uid).catch(() => {});
    void this.#h.youtube
      .setOutputDevice(target?.name)
      .then((ok) => {
        if (ok || !target || this.#disposed || this.#applied !== target) return;
        this.#h.toast(`YouTube can't play to ${target.name} · using System default`);
        this.#h.changed();
      })
      .catch(() => {});
  }

  #choose(device: OutputDevice | undefined): void {
    this.#chosen = device;
    this.#save();
    this.#apply();
    this.#h.toast(`Sound output: ${device?.name ?? "System default"}`);
  }

  #save(): void {
    this.#h.store.write("sound", { volume: this.#volume, output: this.#chosen });
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

  payload(): SoundPayload {
    const selected = this.#effective();
    return {
      selected: selected?.uid ?? "default",
      label: selected?.name ?? "System default",
      ...(this.#missing()
        ? { hint: `${this.#chosen!.name} isn't connected · using System default` }
        : {}),
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
