import type {
  Command,
  GridItem,
  QuickItem,
  QuickPayload,
  SoundPayload,
} from "../../shared/protocol.ts";
import type { Clock } from "../ports/clock.ts";

const IDLE_MS = 10_000;
const NAV = ["up", "down", "left", "right"];

export interface QuickSettingsHost {
  clock: Clock;
  /** Sound output's own rows and picking (`SoundOutput`); the drawer never re-implements them. */
  sound: {
    grid(): GridItem[];
    payload(): SoundPayload;
    action(action: string): boolean;
    readonly volume: number;
    readonly muted: boolean;
  };
  /** Something plays in the front, so Picture off makes sense. */
  playing(): boolean;
  stepVolume(delta: number): void;
  toggleMute(): void;
  /** Whether Picture off is on right now. */
  pictureIsOff(): boolean;
  setPictureOff(on: boolean): void;
  openSettings(): void;
  changed(): void;
}

const VOLUME_STEP = 5;

/** The Volume row works like a slider; a click on its buttons does the same as the keys. */
const VOLUME_CONTROLS = new Map<string, (h: QuickSettingsHost) => void>([
  ["vol:down", (h) => h.stepVolume(-VOLUME_STEP)],
  ["vol:up", (h) => h.stepVolume(VOLUME_STEP)],
  ["vol:mute", (h) => h.toggleMute()],
]);

/**
 * Quick settings: the drawer over any App or the Library with the few things changed mid-watch.
 * It owns only what is open and what is highlighted; the actions are the host's.
 */
export class QuickSettings {
  #h: QuickSettingsHost;
  #open = false;
  #focus = "";
  #cancelIdle: (() => void) | undefined;

  constructor(host: QuickSettingsHost) {
    this.#h = host;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  open(): void {
    if (this.#open) return;
    this.#open = true;
    this.#focus = this.#items().find((i) => i.checked)?.id ?? this.#items()[0]!.id;
    this.#arm();
  }

  close(): void {
    this.#open = false;
    this.#cancelIdle?.();
    this.#cancelIdle = undefined;
  }

  toggle(): void {
    if (this.#open) this.close();
    else this.open();
  }

  #arm(): void {
    this.#cancelIdle?.();
    this.#cancelIdle = this.#h.clock.setTimeout(() => {
      this.close();
      this.#h.changed();
    }, IDLE_MS);
  }

  #items(): QuickItem[] {
    const selected = this.#h.sound.payload().selected;
    const outputs = this.#h.sound.grid().map((g, r) => ({
      id: `out:${g.id === "default" ? "default" : g.id.slice(4)}`,
      r,
      c: 0,
      label: g.label,
      action: g.action,
      checked: (g.id === "default" ? "default" : g.id.slice(4)) === selected,
    }));
    const r = outputs.length;
    return [
      ...outputs,
      { id: "vol", r, c: 0, label: "Volume" },
      ...(this.#h.playing()
        ? [
            {
              id: "picture",
              r: r + 1,
              c: 0,
              label: this.#h.pictureIsOff() ? "Picture on" : "Picture off",
            },
          ]
        : []),
      { id: "settings", r: r + (this.#h.playing() ? 2 : 1), c: 0, label: "All settings" },
    ];
  }

  payload(): QuickPayload | undefined {
    if (!this.#open) return undefined;
    const items = this.#items();
    const focusedId = items.some((i) => i.id === this.#focus) ? this.#focus : items[0]!.id;
    return {
      items,
      focusedId,
      volume: this.#h.sound.volume,
      muted: this.#h.sound.muted,
    };
  }

  /** The drawer takes every command meant to move or pick; true when it consumed it. Any command is input. */
  handle(command: Command): boolean {
    if (!this.#open) return false;
    this.#arm();
    const name = command.command;
    if (name === "quickClose" || name === "back" || name === "quickSettings") {
      this.close();
      return true;
    }
    if (name === "home") {
      this.close();
      return false;
    }
    if (name === "quickPick") {
      const id = command.args?.item;
      const control = typeof id === "string" ? VOLUME_CONTROLS.get(id) : undefined;
      if (control) {
        this.#focus = "vol";
        control(this.#h);
        return true;
      }
      const item = this.#items().find((i) => i.id === id);
      if (item) this.#focus = item.id;
      if (item) this.#activate(item);
      return true;
    }
    if (name === "focusAt") {
      const item = this.#items().find((i) => i.r === command.args?.r && i.c === command.args?.c);
      if (item) this.#focus = item.id;
      return true;
    }
    if (NAV.includes(name)) {
      this.#move(name);
      return true;
    }
    if (name === "ok") {
      const item = this.#items().find((i) => i.id === this.#focus);
      if (item) this.#activate(item);
      return true;
    }
    return ["showControls", "find", "screenKey", "menu", "typeOpen"].includes(name);
  }

  #move(direction: string): void {
    const items = this.#items();
    const cur = items.find((i) => i.id === this.#focus) ?? items[0]!;
    if (direction === "left" || direction === "right") {
      if (cur.id === "vol")
        VOLUME_CONTROLS.get(direction === "left" ? "vol:down" : "vol:up")!(this.#h);
      else if (direction === "right") this.close();
      return;
    }
    const next = items.find((i) => i.r === cur.r + (direction === "down" ? 1 : -1));
    if (next) this.#focus = next.id;
  }

  #activate(item: QuickItem): void {
    if (item.action) this.#h.sound.action(item.action);
    else if (item.id === "vol") this.#h.toggleMute();
    else if (item.id === "picture") {
      this.close();
      this.#h.setPictureOff(!this.#h.pictureIsOff());
    } else if (item.id === "settings") {
      this.close();
      this.#h.openSettings();
    }
  }
}
