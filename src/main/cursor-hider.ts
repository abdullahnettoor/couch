import type { Clock } from "./ports/clock.ts";

const IDLE_MS = 3000;
const POLL_MS = 250;

export interface CursorPorts {
  clock: Clock;
  /** Where the mouse is on the Mac, whichever view is under it. */
  pointer(): { x: number; y: number };
  setHidden(hidden: boolean): void;
}

/**
 * Hides the Mac's mouse cursor after about 3 s at rest while playback is on screen, and shows it
 * the moment the mouse moves. It watches the pointer itself, so it doesn't matter which view is
 * under it (the renderer, mpv, a web App or the picture-off cover).
 */
export class CursorHider {
  #ports: CursorPorts;
  #on = false;
  #hidden = false;
  #last = { x: 0, y: 0 };
  #restSince = 0;
  #stop: (() => void) | undefined;

  constructor(ports: CursorPorts) {
    this.#ports = ports;
  }

  /** Playback is (or is no longer) on screen. Safe to call on every update. */
  playing(on: boolean): void {
    if (on === this.#on) return;
    this.#on = on;
    if (!on) return this.release();
    this.#last = this.#ports.pointer();
    this.#restSince = this.#ports.clock.now();
    this.#stop = this.#ports.clock.setInterval(() => this.#tick(), POLL_MS);
  }

  /** Show the cursor and stop watching (focus lost, quitting). */
  release(): void {
    this.#on = false;
    this.#stop?.();
    this.#stop = undefined;
    this.#show();
  }

  #show(): void {
    if (!this.#hidden) return;
    this.#hidden = false;
    this.#ports.setHidden(false);
  }

  #tick(): void {
    const now = this.#ports.clock.now();
    const at = this.#ports.pointer();
    if (at.x !== this.#last.x || at.y !== this.#last.y) {
      this.#last = at;
      this.#restSince = now;
      this.#show();
    } else if (!this.#hidden && now - this.#restSince >= IDLE_MS) {
      this.#hidden = true;
      this.#ports.setHidden(true);
    }
  }
}
