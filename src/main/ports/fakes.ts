import type { LoadOptions, Player, PlayerEvent } from "../../shared/player.ts";
import type { Clock } from "./clock.ts";
import type { DisplayInfo, Mac } from "./mac.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "./youtube.ts";

function emitter<E>() {
  const listeners = new Set<(event: E) => void>();
  return {
    on(listener: (event: E) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(event: E) {
      for (const l of [...listeners]) l(event);
    },
  };
}

export class FakePlayer implements Player {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  #events = emitter<PlayerEvent>();
  position: number | undefined;

  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
    return Promise.resolve();
  }
  load(path: string, options?: LoadOptions) {
    return this.#record("load", path, options);
  }
  setPaused(paused: boolean) {
    return this.#record("setPaused", paused);
  }
  seekBy(seconds: number) {
    return this.#record("seekBy", seconds);
  }
  seekTo(seconds: number) {
    return this.#record("seekTo", seconds);
  }
  getPosition() {
    return Promise.resolve(this.position);
  }
  stop() {
    return this.#record("stop");
  }
  onEvent(listener: (event: PlayerEvent) => void) {
    return this.#events.on(listener);
  }
  dispose() {
    return this.#record("dispose");
  }
  emit(event: PlayerEvent) {
    this.#events.emit(event);
  }
}

export class FakeYouTube implements YouTube {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  #events = emitter<YouTubeEvent>();
  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
  }
  show(note?: string) {
    this.#record("show", note);
  }
  hide() {
    this.#record("hide");
  }
  sendKey(key: YouTubeKey) {
    this.#record("sendKey", key);
  }
  openSearch() {
    this.#record("openSearch");
  }
  setSearchText(text: string) {
    this.#record("setSearchText", text);
  }
  submitSearch() {
    this.#record("submitSearch");
  }
  playPause() {
    this.#record("playPause");
  }
  restart() {
    this.#record("restart");
  }
  onEvent(listener: (event: YouTubeEvent) => void) {
    return this.#events.on(listener);
  }
  emit(event: YouTubeEvent) {
    this.#events.emit(event);
  }
}

export class FakeMac implements Mac {
  readonly calls: Array<{ call: string; args: unknown[] }> = [];
  volume = 50;
  displays: DisplayInfo[] = [{ id: 1, label: "Built-in", internal: true }];
  /** Scripted result of the next folder pick. */
  folderPick: string | undefined;
  #record(call: string, ...args: unknown[]) {
    this.calls.push({ call, args });
  }
  getVolume() {
    return Promise.resolve(this.volume);
  }
  setVolume(percent: number) {
    this.volume = percent;
    this.#record("setVolume", percent);
    return Promise.resolve();
  }
  keepAwake(keep: boolean) {
    this.#record("keepAwake", keep);
  }
  keepDisplayAwake(keep: boolean) {
    this.#record("keepDisplayAwake", keep);
  }
  wakeDisplay() {
    this.#record("wakeDisplay");
  }
  listDisplays() {
    return this.displays;
  }
  pickFolder() {
    this.#record("pickFolder");
    return Promise.resolve(this.folderPick);
  }
  localName() {
    return "test-mac.local";
  }
  quit() {
    this.#record("quit");
  }
}

/** A clock that only moves when a test calls `advance`. Starts at 2026-10-20 08:30 UTC. */
export class FakeClock implements Clock {
  #now = Date.UTC(2026, 9, 20, 8, 30, 0);
  #timers: Array<{ at: number; fn: () => void; every?: number; dead: boolean }> = [];

  now() {
    return this.#now;
  }
  setTimeout(fn: () => void, ms: number) {
    return this.#add(fn, ms);
  }
  setInterval(fn: () => void, ms: number) {
    return this.#add(fn, ms, ms);
  }
  #add(fn: () => void, ms: number, every?: number) {
    const timer = { at: this.#now + ms, fn, every, dead: false };
    this.#timers.push(timer);
    return () => {
      timer.dead = true;
    };
  }
  advance(ms: number) {
    const target = this.#now + ms;
    for (;;) {
      this.#timers = this.#timers.filter((t) => !t.dead);
      const next = this.#timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.#now = next.at;
      if (next.every) next.at += next.every;
      else next.dead = true;
      next.fn();
    }
    this.#now = target;
  }
}
