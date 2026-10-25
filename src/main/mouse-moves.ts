/**
 * The one native mouse-moved subscription (`watchMouseMoves` replaces any earlier watcher, so a second
 * registration would silently break the first), shared by whoever needs movement: the cursor hider and
 * the Quick settings edge gesture. It watches while at least one of them listens.
 */
export class MouseMoves {
  #watch: (cb: () => void) => () => void;
  #listeners = new Set<() => void>();
  #stop: (() => void) | undefined;

  constructor(watch: (cb: () => void) => () => void) {
    this.#watch = watch;
  }

  /** Calls `cb` on every movement; returns a function that stops. */
  subscribe = (cb: () => void): (() => void) => {
    const entry = () => cb();
    this.#listeners.add(entry);
    this.#stop ??= this.#watch(() => [...this.#listeners].forEach((l) => l()));
    return () => {
      this.#listeners.delete(entry);
      if (this.#listeners.size === 0) {
        this.#stop?.();
        this.#stop = undefined;
      }
    };
  };
}
