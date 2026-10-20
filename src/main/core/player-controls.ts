import { basename } from "node:path";
import type { Command, GridItem, LibraryEntry, ScreenState } from "../../shared/protocol.ts";
import { DOCK_IDS, DOCK_LABELS, DOCK_ROW, type DockId } from "../../shared/player-dock.ts";
import type { NextCardId } from "../../shared/player.ts";
import type { Clock } from "../ports/clock.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import { cleanTitle } from "./library.ts";

const SKIP_SECONDS = 10;
const VOLUME_STEP = 5;
const CONTROLS_MS = 4500;
const NEXT_CARD_MS = 15_000;
const CARD_IDS: NextCardId[] = ["playnext", "backfolder"];

/** What the controls ask of the player and the core. */
export interface ControlsHost {
  clock: Clock;
  /** The playing video, if any. */
  playing(): { path: string; position: number; paused: boolean } | undefined;
  seekTo(seconds: number): void;
  togglePause(): void;
  toggleSubtitles(): void;
  setVolume(percent: number): void;
  play(path: string): void;
  /** Leave playback as the end of a video does (the end-of-video card was dismissed or timed out). */
  leave(): void;
  /** The controls' own state changed (e.g. the timer hid them). */
  changed(): void;
}

/**
 * The player's dock and Up next row: which is showing, where focus is, the 4.5 s hide timer,
 * and what Left/Right/Up/Down/OK mean. Writes `controls` and `focus.player` on the shared Screen state.
 */
export class PlayerControls {
  #state: ScreenState;
  #host: ControlsHost;
  #cancelTimer: (() => void) | undefined;
  /** The playing video's folder (videos only), read when it starts. */
  #upNext: LibraryEntry[] = [];
  /** The video the end-of-video card offers, while it shows. */
  #next: LibraryEntry | undefined;
  #cancelCard: (() => void) | undefined;

  constructor(state: ScreenState, host: ControlsHost) {
    this.#state = state;
    this.#host = host;
  }

  get upNext(): readonly LibraryEntry[] {
    return this.#upNext;
  }

  /** Up next needs another video in the folder to be worth opening. */
  get upNextAvailable(): boolean {
    return this.#upNext.length > 1;
  }

  /** A video started: the dock shows, focused on play/pause. */
  begin(upNext: LibraryEntry[]): void {
    this.#upNext = upNext;
    this.#next = undefined;
    this.#cancelCard?.();
    this.#state.focus.player = { r: DOCK_ROW, c: DOCK_IDS.indexOf("playpause") };
    this.#state.controls = "dock";
    this.show();
  }

  /** The next video in the folder after the playing one, when there is one. */
  get next(): LibraryEntry | undefined {
    return this.#next;
  }

  /** The playing video ended: show the card if a video follows it. False when it was the last. */
  offerNext(): boolean {
    const path = this.#host.playing()?.path;
    const i = this.#upNext.findIndex((e) => e.path === path);
    const next = i === -1 ? undefined : this.#upNext[i + 1];
    if (!next) return false;
    this.#next = next;
    this.#cancelTimer?.();
    this.#state.controls = "next";
    this.#state.focus.player = { r: 0, c: 0 };
    this.#cancelCard = this.#host.clock.setTimeout(() => this.#host.leave(), NEXT_CARD_MS);
    return true;
  }

  focusedCard(): NextCardId {
    return CARD_IDS[this.#state.focus.player?.c ?? 0] ?? "playnext";
  }

  /** OK on the card's Play (or the phone's playNext). Refused when there's no card. */
  playNext(): void {
    const next = this.#next;
    if (this.#state.controls === "next" && next) this.#host.play(next.path);
  }

  end(): void {
    this.#upNext = [];
    this.#next = undefined;
    this.#cancelCard?.();
    this.#state.controls = "hidden";
    this.#cancelTimer?.();
  }

  dispose(): void {
    this.#cancelTimer?.();
    this.#cancelCard?.();
  }

  /** Bring the dock up and (re)start the countdown; while paused it stays up. */
  show(): void {
    if (this.#state.controls === "next") return;
    if (this.#state.controls !== "upnext") this.#state.controls = "dock";
    this.#cancelTimer?.();
    this.#cancelTimer = this.#host.clock.setTimeout(() => {
      if (this.#host.playing()?.paused) return;
      if (this.#state.controls === "upnext") this.#closeUpNext();
      this.#state.controls = "hidden";
      this.#host.changed();
    }, CONTROLS_MS);
  }

  /** The dock's focusable items on row DOCK_ROW, plus the Up next tiles on row 0 while it is open. */
  grid(): GridItem[] {
    if (this.#state.controls === "next")
      return [
        { id: "playnext", r: 0, c: 0, label: "Play", action: "next:play", initial: true },
        { id: "backfolder", r: 0, c: 1, label: "Back to folder", action: "next:leave" },
      ];
    const dock = DOCK_IDS.flatMap((id, c): GridItem[] =>
      id === "upnext" && !this.upNextAvailable
        ? []
        : [
            {
              id,
              r: DOCK_ROW,
              c,
              label: DOCK_LABELS[id],
              action: `dock:${id}`,
              initial: id === "playpause",
            },
          ],
    );
    if (this.#state.controls !== "upnext") return dock;
    const tiles = this.#upNext.map((e, i): GridItem => ({
      id: e.path,
      r: 0,
      c: i,
      label: cleanTitle(basename(e.path)),
      action: `upnext:${i}`,
    }));
    return [...tiles, ...dock];
  }

  focusedDock(): DockId {
    const item = resolveFocus(this.grid(), this.#state.focus.player);
    return (item && item.r === DOCK_ROW ? item.id : "playpause") as DockId;
  }

  /** The focused Up next tile, while the row has focus. */
  get focusedTile(): number | undefined {
    const focus = this.#state.focus.player;
    return focus && focus.r === 0 ? focus.c : undefined;
  }

  /** Play the nth video of the Up next list. Out-of-range indexes are ignored. */
  playUpNext(index: unknown): void {
    const entry = typeof index === "number" ? this.#upNext[index] : undefined;
    if (entry) this.#host.play(entry.path);
  }

  /** Back closes an open Up next row; false when it isn't open. */
  back(): boolean {
    if (this.#state.controls !== "upnext") return false;
    this.#closeUpNext();
    this.show();
    return true;
  }

  /** Directional, OK and showControls commands. False for the ones the core handles itself. */
  command(command: Command): boolean {
    const name = command.command;
    const host = this.#host;
    const visible = this.#state.controls !== "hidden";
    if (this.#state.controls === "next") return this.#cardCommand(name);
    const upNextOpen = this.#state.controls === "upnext";
    this.show();
    if (upNextOpen && this.#state.focus.player?.r === 0) {
      switch (name) {
        case "left":
        case "right":
          this.#step(name);
          return true;
        case "down":
          this.#state.focus.player = { r: DOCK_ROW, c: DOCK_IDS.indexOf("upnext") };
          return true;
        case "ok":
          this.playUpNext(this.#state.focus.player.c);
          return true;
      }
    }
    switch (name) {
      case "left":
      case "right": {
        const sign = name === "right" ? 1 : -1;
        const focused = this.focusedDock();
        const p = host.playing()!;
        if (!visible || focused === "bar") host.seekTo(p.position + sign * SKIP_SECONDS);
        else if (focused === "volume") host.setVolume(this.#state.volume + sign * VOLUME_STEP);
        else this.#step(name);
        return true;
      }
      case "up":
      case "down": {
        if (name === "down" && !upNextOpen) {
          if (this.#openUpNext()) return true;
        } else if (name === "up" && upNextOpen) {
          this.#focusRow();
          return true;
        }
        // Left/Right belong to the bar and the slider, so Up/Down step off them.
        const focused = this.focusedDock();
        if (visible && (focused === "bar" || focused === "volume"))
          this.#step(name === "up" ? "left" : "right");
        return true;
      }
      case "ok":
        if (!visible) host.togglePause();
        else this.#activate(this.focusedDock(), upNextOpen);
        return true;
      case "showControls":
        return true;
      default:
        return false;
    }
  }

  #cardCommand(name: Command["command"]): boolean {
    switch (name) {
      case "left":
      case "right":
        this.#step(name);
        return true;
      case "ok":
        if (this.focusedCard() === "playnext") this.playNext();
        else this.#host.leave();
        return true;
      case "volUp":
      case "volDown":
        return false;
      default:
        return true;
    }
  }

  #activate(id: DockId, upNextOpen: boolean): void {
    const host = this.#host;
    const position = host.playing()!.position;
    switch (id) {
      case "playpause":
      case "bar":
        host.togglePause();
        break;
      case "back10":
        host.seekTo(position - SKIP_SECONDS);
        break;
      case "fwd10":
        host.seekTo(position + SKIP_SECONDS);
        break;
      case "subtitles":
        host.toggleSubtitles();
        break;
      case "upnext":
        if (upNextOpen) this.#closeUpNext();
        else this.#openUpNext();
        break;
    }
  }

  #step(direction: "left" | "right"): void {
    const grid = this.grid();
    const next = moveFocus(grid, resolveFocus(grid, this.#state.focus.player)!, direction);
    this.#state.focus.player = { r: next.r, c: next.c };
  }

  #playingIndex(): number {
    const path = this.#host.playing()?.path;
    return Math.max(
      0,
      this.#upNext.findIndex((e) => e.path === path),
    );
  }

  #focusRow(): void {
    this.#state.focus.player = { r: 0, c: this.#playingIndex() };
  }

  /** Opens Up next; false when the folder has no other videos to show. */
  #openUpNext(): boolean {
    if (!this.upNextAvailable) return false;
    this.#state.controls = "upnext";
    this.#focusRow();
    return true;
  }

  #closeUpNext(): void {
    this.#state.controls = "dock";
    this.#state.focus.player = { r: DOCK_ROW, c: DOCK_IDS.indexOf("upnext") };
  }
}
