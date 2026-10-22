import type { Clock } from "../ports/clock.ts";
import type { Store } from "../ports/store.ts";

const DEFAULT_MINUTES = 10;

/** What a web-App host reports about itself so the unloader can follow it. */
export interface IdleLifecycle {
  shown(): void;
  hidden(): void;
}

interface Tracked {
  unload: () => void;
  loaded: boolean;
  hiddenAt: number;
  cancel?: () => void;
}

/**
 * Unloads web Apps nobody is using: the App in front and the most recently used one stay loaded,
 * every other loaded App unloads once it has been hidden for `idleUnloadMinutes`
 * (Store document "webApps", default 10).
 */
export class IdleUnloader {
  #clock: Clock;
  #store: Store;
  #apps = new Map<string, Tracked>();
  #front: string | undefined;
  #recent: string | undefined;

  constructor(clock: Clock, store: Store) {
    this.#clock = clock;
    this.#store = store;
  }

  /** `loaded`: the App is already loading (YouTube at launch), and counts as the most recent one. */
  track(id: string, unload: () => void, options: { loaded?: boolean } = {}): IdleLifecycle {
    const loaded = options.loaded === true;
    this.#apps.set(id, { unload, loaded, hiddenAt: this.#clock.now() });
    if (loaded) this.#recent ??= id;
    return {
      shown: () => this.#shown(id),
      hidden: () => this.#hidden(id),
    };
  }

  #shown(id: string): void {
    const app = this.#apps.get(id)!;
    app.loaded = true;
    this.#front = id;
    if (this.#recent === id) this.#recent = undefined;
    this.#settle();
  }

  #hidden(id: string): void {
    const app = this.#apps.get(id)!;
    app.hiddenAt = this.#clock.now();
    if (this.#front === id) this.#front = undefined;
    this.#recent = id;
    this.#settle();
  }

  #minutes(): number {
    const doc = this.#store.read<{ idleUnloadMinutes?: unknown }>("webApps", {});
    const m = doc.idleUnloadMinutes;
    return typeof m === "number" && m > 0 ? m : DEFAULT_MINUTES;
  }

  /** Every loaded App that is neither front nor most recent gets a timer from when it was hidden. */
  #settle(): void {
    for (const [id, app] of this.#apps) {
      const keep = id === this.#front || id === this.#recent || !app.loaded;
      if (keep) {
        app.cancel?.();
        app.cancel = undefined;
        continue;
      }
      if (app.cancel) continue;
      const wait = Math.max(0, this.#minutes() * 60_000 - (this.#clock.now() - app.hiddenAt));
      app.cancel = this.#clock.setTimeout(() => {
        app.cancel = undefined;
        app.loaded = false;
        app.unload();
      }, wait);
    }
  }
}
