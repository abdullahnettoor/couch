import type { Clock } from "./ports/clock.ts";

const EDGE_PX = 2;
export const DWELL_MS = 500;

export interface EdgePorts {
  clock: Clock;
  /** Calls `cb` on every mouse movement; returns a function that stops (the shared subscription). */
  onMouseMoved(cb: () => void): () => void;
  /** The pointer, from the Screen's left edge and top; undefined when it is outside the Screen. */
  position(): { x: number; y: number } | undefined;
  open(): void;
}

/**
 * The Screen's left-edge gesture for Quick settings: the pointer moved onto the far left edge and
 * then rests there about half a second. It listens for movement and reads the position only then,
 * so a pointer parked at the edge (during playback, say) never opens it. It fires once per visit.
 */
export class EdgeGesture {
  #ports: EdgePorts;
  #stopWatching: (() => void) | undefined;
  #cancelDwell: (() => void) | undefined;
  #fired = false;

  constructor(ports: EdgePorts) {
    this.#ports = ports;
  }

  /** Start listening (Couch is focused and visible). */
  start(): void {
    if (this.#stopWatching) return;
    this.#stopWatching = this.#ports.onMouseMoved(() => this.#moved());
  }

  /** Stop and forget everything (focus lost, hidden, quitting). */
  stop(): void {
    this.#stopWatching?.();
    this.#stopWatching = undefined;
    this.#cancelDwell?.();
    this.#cancelDwell = undefined;
    this.#fired = false;
  }

  #moved(): void {
    const p = this.#ports.position();
    if (!p || p.x > EDGE_PX) {
      this.#cancelDwell?.();
      this.#cancelDwell = undefined;
      this.#fired = false;
      return;
    }
    if (this.#fired) return;
    this.#cancelDwell?.();
    this.#cancelDwell = this.#ports.clock.setTimeout(() => {
      this.#cancelDwell = undefined;
      this.#fired = true;
      this.#ports.open();
    }, DWELL_MS);
  }
}
