import type { Clock } from "./ports/clock.ts";

const IDLE_MS = 3000;

export interface CursorPorts {
  clock: Clock;
  /** Calls `cb` on every mouse movement over any of Couch's views; returns a function that stops. */
  onMouseMoved(cb: () => void): () => void;
  /** Hides the Mac cursor until the mouse moves, or shows it. Showing must be idempotent. */
  setHidden(hidden: boolean): void;
}

/**
 * Hides the Mac's mouse cursor after about 3 s without mouse movement while playback is on screen.
 * It listens for movement events instead of sampling the position, so a mouse that leaves and
 * comes back to the same spot still shows the cursor and restarts the timer.
 */
export class CursorHider {
  #ports: CursorPorts;
  #on = false;
  #hidden = false;
  #stopWatching: (() => void) | undefined;
  #cancelIdle: (() => void) | undefined;

  constructor(ports: CursorPorts) {
    this.#ports = ports;
  }

  /** Playback is (or is no longer) on screen. Safe to call on every update. */
  playing(on: boolean): void {
    if (on === this.#on) return;
    if (!on) return this.release();
    this.#on = true;
    this.#stopWatching = this.#ports.onMouseMoved(() => this.#moved());
    this.#arm();
  }

  /** Show the cursor and stop watching (focus lost, quitting). Always leaves it visible. */
  release(): void {
    this.#on = false;
    this.#stopWatching?.();
    this.#stopWatching = undefined;
    this.#cancelIdle?.();
    this.#cancelIdle = undefined;
    this.#hidden = false;
    this.#ports.setHidden(false);
  }

  #moved(): void {
    if (!this.#on) return;
    if (this.#hidden) {
      this.#hidden = false;
      this.#ports.setHidden(false);
    }
    this.#arm();
  }

  #arm(): void {
    this.#cancelIdle?.();
    this.#cancelIdle = this.#ports.clock.setTimeout(() => {
      this.#cancelIdle = undefined;
      this.#hidden = true;
      this.#ports.setHidden(true);
    }, IDLE_MS);
  }
}
