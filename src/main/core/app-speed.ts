/** A mouse press or key on an App's page this recent counts as the household choosing the page's speed. */
export const PAGE_INPUT_WINDOW_MS = 2000;
/** After Couch applied a speed, a differing report within this long may still be the old rate. */
export const STALE_REPORT_WINDOW_MS = 3000;
/** A page that resets the rate is told again at most this often. */
export const REAPPLY_THROTTLE_MS = 3000;

interface Wanted {
  speed: number;
  key: string;
  /** When Couch last applied a speed to the page; undefined if it hasn't for this video. */
  appliedAt?: number;
}

/**
 * Each web App's wanted speed for the video it plays. A video starts at 1×; a speed the household
 * picks on the page (or a phone command) becomes the wanted one, and a page that resets the rate
 * is told again.
 */
export class AppSpeed {
  #wanted = new Map<string, Wanted>();
  #input = new Map<string, number>();
  #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  wanted(app: string): number | undefined {
    return this.#wanted.get(app)?.speed;
  }

  /** A mouse press or key reached the App's page. */
  input(app: string): void {
    this.#input.set(app, this.#now());
  }

  /** The phone chose a speed; it overrides whatever the page did before. */
  command(app: string, speed: number, key: string): void {
    this.#input.delete(app);
    this.#wanted.set(app, { speed, key, appliedAt: this.#now() });
  }

  clear(app: string): void {
    this.#wanted.delete(app);
    this.#input.delete(app);
  }

  /** The page reported a speed; returns the speed Couch must apply to it, if any. */
  report(app: string, key: string, speed: number): number | undefined {
    const now = this.#now();
    let want = this.#wanted.get(app);
    if (!want || want.key !== key) {
      want = { speed: 1, key };
      this.#wanted.set(app, want);
      if (speed === 1) return undefined;
      want.appliedAt = now;
      return 1;
    }
    if (speed === want.speed) return undefined;
    const input = this.#input.get(app);
    const justChose = input !== undefined && now - input <= PAGE_INPUT_WINDOW_MS;
    const mayBeStale =
      want.appliedAt !== undefined && now - want.appliedAt < STALE_REPORT_WINDOW_MS;
    if (justChose || (!mayBeStale && speed !== 1)) {
      want.speed = speed;
      want.appliedAt = undefined;
      return undefined;
    }
    if (want.appliedAt !== undefined && now - want.appliedAt < REAPPLY_THROTTLE_MS)
      return undefined;
    want.appliedAt = now;
    return want.speed;
  }
}
