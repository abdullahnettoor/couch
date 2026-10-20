import {
  VIEW_LABELS,
  type Command,
  type GridItem,
  type RemoteId,
  type RemoteSnapshot,
  type ScreenPayload,
  type ScreenState,
} from "../../shared/protocol.ts";
import type { Player } from "../../shared/player.ts";
import type { Clock } from "../ports/clock.ts";
import type { Mac } from "../ports/mac.ts";
import type { YouTube } from "../ports/youtube.ts";
import { moveFocus, resolveFocus } from "./focus.ts";

export interface Ports {
  player: Player;
  youtube: YouTube;
  mac: Mac;
  clock: Clock;
}

/** Who sent a command: a connected phone, or the Screen's own keyboard. */
export type Source = RemoteId | "screen";

const TOAST_MS = 3000;

/** The single source of truth: holds the Screen state and turns commands into new state. */
export class Core {
  #ports: Ports;
  #state: ScreenState = {
    view: "home",
    focus: {},
    query: "",
    subtitlesOn: true,
    volume: 0,
    remotes: 0,
  };
  #grids = new Map<string, GridItem[]>();
  #remotes = new Set<RemoteId>();
  #listeners = new Set<() => void>();
  #cancelToast: (() => void) | undefined;
  #cancelMinute: (() => void) | undefined;

  constructor(ports: Ports) {
    this.#ports = ports;
    this.#scheduleMinute();
    void ports.mac
      .getVolume()
      .then((volume) => {
        this.#state.volume = volume;
        this.#emit();
      })
      .catch(() => {});
  }

  get viewKey(): string {
    return this.#state.view;
  }

  /** Everything the Screen renderer needs to draw. */
  screen(): ScreenPayload {
    const grid = this.#grids.get(this.viewKey) ?? [];
    const focused = resolveFocus(grid, this.#state.focus[this.viewKey]);
    return {
      state: structuredClone(this.#state),
      viewKey: this.viewKey,
      grid,
      focusedId: focused?.id,
      focusedLabel: focused?.label,
      now: this.#ports.clock.now(),
    };
  }

  snapshot(remote: RemoteId): RemoteSnapshot {
    const s = this.#state;
    return {
      type: "snapshot",
      where: VIEW_LABELS[s.view],
      view: s.view,
      typeAvailable: s.view === "youtube",
      typing: s.typingBy === undefined ? "none" : s.typingBy === remote ? "you" : "other",
      volume: s.volume,
      remotes: s.remotes,
    };
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  connect(remote: RemoteId): void {
    this.#remotes.add(remote);
    this.#state.remotes = this.#remotes.size;
    this.#emit();
  }

  disconnect(remote: RemoteId): void {
    if (!this.#remotes.delete(remote)) return;
    this.#state.remotes = this.#remotes.size;
    if (this.#state.typingBy === remote) this.#state.typingBy = undefined;
    this.#emit();
  }

  /** The renderer reports the grid of focusable items it drew for a view. */
  reportGrid(viewKey: string, items: GridItem[]): void {
    this.#grids.set(viewKey, items);
    this.#emit();
  }

  handle(command: Command, _from: Source): void {
    switch (command.command) {
      case "up":
      case "down":
      case "left":
      case "right":
        this.#move(command.command);
        break;
      case "ok":
        this.#ok();
        break;
      case "back":
        break;
      case "home":
        this.#state.view = "home";
        break;
      default:
        break;
    }
    this.#emit();
  }

  dispose(): void {
    this.#cancelToast?.();
    this.#cancelMinute?.();
    this.#listeners.clear();
  }

  #move(direction: "up" | "down" | "left" | "right"): void {
    const grid = this.#grids.get(this.viewKey) ?? [];
    const current = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!current) return;
    const next = moveFocus(grid, current, direction);
    this.#state.focus[this.viewKey] = { r: next.r, c: next.c };
  }

  #ok(): void {
    const grid = this.#grids.get(this.viewKey) ?? [];
    const item = resolveFocus(grid, this.#state.focus[this.viewKey]);
    if (!item) return;
    // Placeholder tiles until the Apps exist (tickets 005+).
    this.#toast(`${item.label} is coming soon`);
  }

  #toast(text: string): void {
    this.#cancelToast?.();
    this.#state.toast = text;
    this.#cancelToast = this.#ports.clock.setTimeout(() => {
      this.#state.toast = undefined;
      this.#emit();
    }, TOAST_MS);
  }

  /** Re-emit on each minute boundary so the Home clock moves. */
  #scheduleMinute(): void {
    const wait = 60_000 - (this.#ports.clock.now() % 60_000);
    this.#cancelMinute = this.#ports.clock.setTimeout(() => {
      this.#emit();
      this.#scheduleMinute();
    }, wait);
  }

  #emit(): void {
    for (const l of [...this.#listeners]) l();
  }
}
