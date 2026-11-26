import type { Clock } from "../ports/clock.ts";
import type { Store } from "../ports/store.ts";
import type {
  AppPointer,
  PointerDraw,
  PointerInput,
  PointerLayer,
  PointerSpeed,
} from "../../shared/pointer.ts";
import { POINTER_SPEEDS } from "../../shared/pointer.ts";

/** The pointer fades after this long without a touch. */
export const POINTER_IDLE_MS = 5000;
/** On Couch's own layers a move is delivered once the pointer has rested this long (or right before a click). */
export const POINTER_DWELL_MS = 300;
/** The most one move may carry, in phone pixels: a flood or a bad value can't throw the pointer across the Screen. */
export const MAX_POINTER_DELTA = 120;
/** Wheel pixels per phone pixel when sliding in a scroll strip. */
const SCROLL_GAIN = 2;

/** Screen pixels per phone pixel at the slowest drag, for each speed setting. */
const BASE_GAIN: Record<PointerSpeed, number> = { slow: 1.4, normal: 2.2, fast: 3.4 };
/** How much faster a quick flick travels: the gain grows with the size of one move, up to this many phone pixels. */
const ACCEL_RANGE = 48;
const ACCEL_SLOPE = 12;

/** Screen pixels for a move of `magnitude` phone pixels: a gain that grows with the speed of the drag. */
export function pointerGain(speed: PointerSpeed, magnitude: number): number {
  return BASE_GAIN[speed] * (1 + Math.min(magnitude, ACCEL_RANGE) / ACCEL_SLOPE);
}

const clampDelta = (n: number) => Math.max(-MAX_POINTER_DELTA, Math.min(MAX_POINTER_DELTA, n));

/** The Store document holding each place's mode: `couch` for all of Couch's own pages, else an App's id. */
const MODES = "pointer.modes";
const SPEED = "pointer.speed";

export interface PointerDeps {
  clock: Clock;
  store: Store;
  /** Where the pointer is drawn and sent: the Screen's content size. */
  size(): { width: number; height: number };
  /** The place whose mode is in force now: an App's id, or `couch`. */
  place(): string;
  /** The layer in front, or undefined where the pointer isn't used (video playing in the Library). */
  layer(): PointerLayer | undefined;
  /** The App in front, when it takes pointer events. */
  app(): { id: string; pointer: AppPointer } | undefined;
  /** Something a phone should see changed (the mode, an edge cue). */
  changed(): void;
}

/**
 * Pointer mode: the per-place mode, the one shared pointer, its fade, and the routing of its events to
 * the layer in front. Drawing and delivery leave through `onDraw` and `onInput`; the App layer is called directly.
 */
export class PointerControl {
  #deps: PointerDeps;
  #x = 0;
  #y = 0;
  #placed = false;
  #wanted = false;
  #drawn: PointerDraw | undefined;
  #cancelIdle: (() => void) | undefined;
  #cancelDwell: (() => void) | undefined;
  #pending = false;
  #atEdge = false;
  #edgeHits = 0;
  #driver: string | undefined;
  #appOn: { id: string; pointer: AppPointer } | undefined;
  #draw = new Set<(draw: PointerDraw) => void>();
  #input = new Set<(input: PointerInput) => void>();

  constructor(deps: PointerDeps) {
    this.#deps = deps;
  }

  onDraw(listener: (draw: PointerDraw) => void): () => void {
    this.#draw.add(listener);
    return () => void this.#draw.delete(listener);
  }

  onInput(listener: (input: PointerInput) => void): () => void {
    this.#input.add(listener);
    return () => void this.#input.delete(listener);
  }

  /** Pointer mode is on for the place in front. */
  get on(): boolean {
    return this.#modes()[this.#deps.place()] === true;
  }

  /** Pointer mode is on, and the layer in front takes the pointer. */
  get active(): boolean {
    return this.#usable();
  }

  /** The pointer speed setting: Normal until the household chooses otherwise. */
  get speed(): PointerSpeed {
    return this.#speed();
  }

  /** Saves the pointer speed and applies it at once. */
  setSpeed(speed: PointerSpeed): void {
    this.#deps.store.write(SPEED, speed);
    this.#deps.changed();
  }

  /** How many times the phone `remote` took the pointer to the Screen's edge; absent for any other phone or before the first. */
  edgeCue(remote: string): number | undefined {
    return this.#driver === remote && this.#edgeHits > 0 ? this.#edgeHits : undefined;
  }

  setMode(on: boolean): void {
    const modes = { ...this.#modes() };
    const place = this.#deps.place();
    if (on) modes[place] = true;
    else delete modes[place];
    this.#deps.store.write(MODES, modes);
    this.sync();
  }

  /** A phone moved its thumb. */
  move(dx: number, dy: number, from: string): void {
    if (!this.#usable()) return;
    this.#take(from);
    const speed = this.#speed();
    const gain = pointerGain(speed, Math.hypot(clampDelta(dx), clampDelta(dy)));
    const { width, height } = this.#deps.size();
    this.#x = Math.max(0, Math.min(width, this.#x + clampDelta(dx) * gain));
    this.#y = Math.max(0, Math.min(height, this.#y + clampDelta(dy) * gain));
    const edge = this.#x <= 0 || this.#y <= 0 || this.#x >= width || this.#y >= height;
    this.#moved();
    if (edge && !this.#atEdge) {
      this.#edgeHits++;
      this.#atEdge = true;
      this.#deps.changed();
    } else if (!edge) this.#atEdge = false;
  }

  /** A tap or long press at the pointer's place. */
  press(kind: "click" | "rightClick", from: string): void {
    if (!this.#usable()) return;
    this.#take(from);
    this.#moved(false);
    this.#flushMove();
    this.#send({ type: kind });
  }

  /** A phone slid along a scroll strip: wheel input at the pointer's place, without moving it. */
  scroll(dx: number, dy: number, from: string): void {
    if (!this.#usable()) return;
    this.#take(from);
    this.#moved(false);
    const sdx = Math.round(clampDelta(dx) * SCROLL_GAIN);
    const sdy = Math.round(clampDelta(dy) * SCROLL_GAIN);
    if (sdx === 0 && sdy === 0) return;
    this.#send({ type: "scroll", dx: sdx, dy: sdy });
  }

  /** The Mac's keyboard or mouse, or a D-pad press: the pointer steps aside until the next touch. */
  hide(): void {
    this.#cancelIdle?.();
    this.#cancelIdle = undefined;
    this.#wanted = false;
    this.#cancelDwell?.();
    this.#cancelDwell = undefined;
    this.#pending = false;
    this.#publish();
  }

  /** Whatever changed (the mode, the front place or layer): hides a pointer that has no place to be, and tells the App in front. */
  sync(): void {
    if (!this.#usable()) this.hide();
    const app = this.on ? this.#deps.app() : undefined;
    if (this.#appOn?.id !== app?.id) {
      this.#appOn?.pointer.setMode(false);
      app?.pointer.setMode(true);
      this.#appOn = app;
    }
    this.#publish();
  }

  dispose(): void {
    this.#cancelIdle?.();
    this.#cancelDwell?.();
    this.#draw.clear();
    this.#input.clear();
  }

  #usable(): boolean {
    return this.on && this.#deps.layer() !== undefined;
  }

  #modes(): Record<string, boolean> {
    return this.#deps.store.read<Record<string, boolean>>(MODES, {});
  }

  #speed(): PointerSpeed {
    const speed = this.#deps.store.read<string>(SPEED, "normal");
    return POINTER_SPEEDS.find((s) => s === speed) ?? "normal";
  }

  #take(from: string): void {
    this.#driver = from;
    if (!this.#placed) {
      const { width, height } = this.#deps.size();
      this.#x = width / 2;
      this.#y = height / 2;
      this.#placed = true;
    }
  }

  /** Shows the pointer, restarts its fade, and sends the move on (live to an App, after a rest to Couch's own layers). */
  #moved(deliver = true): void {
    this.#wanted = true;
    this.#cancelIdle?.();
    this.#cancelIdle = this.#deps.clock.setTimeout(() => this.hide(), POINTER_IDLE_MS);
    this.#publish();
    if (!deliver) return;
    if (this.#deps.layer() === "app") {
      this.#deps.app()?.pointer.move(this.#x, this.#y);
      return;
    }
    this.#pending = true;
    this.#cancelDwell?.();
    this.#cancelDwell = this.#deps.clock.setTimeout(() => this.#flushMove(), POINTER_DWELL_MS);
  }

  #flushMove(): void {
    this.#cancelDwell?.();
    this.#cancelDwell = undefined;
    if (!this.#pending) return;
    this.#pending = false;
    this.#send({ type: "move" });
  }

  #send(
    event: { type: "move" | "click" | "rightClick" } | { type: "scroll"; dx: number; dy: number },
  ): void {
    const layer = this.#deps.layer();
    if (!layer) return;
    if (layer === "app") {
      const app = this.#deps.app()?.pointer;
      if (event.type === "click") app?.click(this.#x, this.#y);
      else if (event.type === "rightClick") app?.rightClick(this.#x, this.#y);
      else if (event.type === "scroll") app?.scroll(this.#x, this.#y, event.dx, event.dy);
      return;
    }
    const input: PointerInput = { layer, x: this.#x, y: this.#y, ...event };
    for (const l of this.#input) l(input);
  }

  #publish(): void {
    const draw: PointerDraw = {
      x: this.#x,
      y: this.#y,
      shown: this.#wanted && this.#usable(),
      style: "arrow",
    };
    const last = this.#drawn;
    if (last && last.x === draw.x && last.y === draw.y && last.shown === draw.shown) return;
    this.#drawn = draw;
    for (const l of this.#draw) l(draw);
  }
}
