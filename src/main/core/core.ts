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
import { randomBytes } from "node:crypto";
import type { Store } from "../ports/store.ts";
import { ACTIONS, BACK_TARGETS, type ActionContext } from "./actions.ts";
import { moveFocus, resolveFocus } from "./focus.ts";

export interface Ports {
  player: Player;
  youtube: YouTube;
  mac: Mac;
  clock: Clock;
  store: Store;
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
  #key: string;
  #port = 0;
  #forgetListeners = new Set<() => void>();

  constructor(ports: Ports) {
    this.#ports = ports;
    const saved = ports.store.read<{ key?: string }>("pairing", {});
    this.#key = typeof saved.key === "string" && saved.key ? saved.key : this.#newKey();
    this.#scheduleMinute();
    void ports.mac
      .getVolume()
      .then((volume) => {
        this.#state.volume = volume;
        this.#emit();
      })
      .catch(() => {});
  }

  #newKey(): string {
    const key = randomBytes(16).toString("base64url");
    this.#ports.store.write("pairing", { key });
    return key;
  }

  /** The Remote server tells the core which port it listens on, for the QR code. */
  setPort(port: number): void {
    this.#port = port;
  }

  acceptsKey(key: string | null | undefined): boolean {
    return typeof key === "string" && key.length > 0 && key === this.#key;
  }

  get pairingUrl(): string {
    return `http://${this.#ports.mac.localName()}:${this.#port}/?key=${this.#key}`;
  }

  /** Called when every phone must be dropped (the key changed). */
  onForget(listener: () => void): () => void {
    this.#forgetListeners.add(listener);
    return () => void this.#forgetListeners.delete(listener);
  }

  forgetAllPhones(): void {
    this.#key = this.#newKey();
    this.#remotes.clear();
    this.#state.remotes = 0;
    this.#state.typingBy = undefined;
    for (const l of [...this.#forgetListeners]) l();
    this.#state.view = "addPhone";
    this.#emit();
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
      pairingUrl: this.pairingUrl,
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
    this.#toast("Phone connected");
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
        this.#back();
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
    if (item.action === "back") return this.#back();
    const action = ACTIONS[item.action];
    // Placeholder tiles until the Apps exist.
    if (action) action(this.#actionContext());
    else this.#toast(`${item.label} is coming soon`);
  }

  #back(): void {
    const target = BACK_TARGETS[this.#state.view];
    if (target) this.#state.view = target;
  }

  #actionContext(): ActionContext {
    return {
      open: (view) => {
        this.#state.view = view;
      },
      toast: (text) => this.#toast(text),
      forgetAllPhones: () => this.forgetAllPhones(),
      quit: () => this.#ports.mac.quit(),
    };
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
