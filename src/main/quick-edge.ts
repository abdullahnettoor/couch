const EDGE_PX = 2;
const DWELL_MS = 500;

/**
 * The Screen's left-edge gesture for Quick settings. It is fed pointer positions (relative to the
 * Screen's left edge) and says when the pointer has rested at the edge for about half a second.
 * It only arms after the pointer moved onto the edge, so a pointer that has sat there unmoved
 * (during playback, say) never opens the drawer; it fires once per visit.
 */
export class EdgeDwell {
  #last: { x: number; y: number } | undefined;
  #since: number | undefined;
  #fired = false;

  sample(x: number, y: number, now: number): boolean {
    const moved = this.#last !== undefined && (this.#last.x !== x || this.#last.y !== y);
    this.#last = { x, y };
    if (x > EDGE_PX) {
      this.#since = undefined;
      this.#fired = false;
      return false;
    }
    if (this.#fired) return false;
    if (moved) this.#since = now;
    if (this.#since === undefined || now - this.#since < DWELL_MS) return false;
    this.#fired = true;
    return true;
  }
}
