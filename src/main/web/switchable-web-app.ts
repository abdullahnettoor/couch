import type { Confirmation, PromptId, TrackKind } from "../../shared/protocol.ts";
import type { YouTube, YouTubeEvent, YouTubeKey } from "../ports/youtube.ts";
import type { KeyGate } from "./keyboard-policy.ts";
import type { Engine } from "./native-front.ts";

/** What the switcher needs of a host beyond the App port: both `ElectronWebApp` and `WebKitWebApp` have it. */
export interface SwitchableHost extends YouTube {
  start(): void;
  focus(): void;
  setKeyGate(gate: KeyGate): void;
  /** Only the WebKit host takes it (Couch's own overlay over the native view). */
  setOverlay?(on: boolean): void;
  /** Takes the host away for good: its view, listeners and timers are gone, and it reports its route back at home. */
  dispose(): void;
}

/**
 * One App port over the engine the household picked: it builds the host for the current engine and swaps it when asked.
 * The swap is transactional: the new host is built and given Couch's state first; only then is the old one disposed
 * (its data stays on disk). A failure before that leaves the old host exactly as it was. A hidden App is never started
 * by a switch: the new host loads on its next show, so the IdleUnloader stays in charge.
 */
export class SwitchableWebApp implements YouTube {
  #create: (engine: Engine) => SwitchableHost;
  #engine: Engine;
  #host: SwitchableHost;
  #stop: () => void;
  #listeners = new Set<(event: YouTubeEvent) => void>();
  #switched = new Set<(engine: Engine) => void>();
  #gate: KeyGate | undefined;
  #volume: number | undefined;
  #output: string | undefined;
  #capturing = false;
  #overlay = false;
  #visible = false;
  #pending: Engine | undefined;

  constructor(create: (engine: Engine) => SwitchableHost, engine: Engine) {
    this.#create = create;
    this.#engine = engine;
    this.#host = create(engine);
    this.#stop = this.#host.onEvent((e) => this.#emit(e));
  }

  get engine(): Engine {
    return this.#engine;
  }

  /** The live host when it is the given engine's, else undefined. */
  host(engine: Engine): SwitchableHost | undefined {
    return engine === this.#engine ? this.#host : undefined;
  }

  /** Hears each completed switch. */
  onSwitch(listener: (engine: Engine) => void): () => void {
    this.#switched.add(listener);
    return () => void this.#switched.delete(listener);
  }

  /** Throws, leaving the old host in place, when the new one can't be built or set up. */
  switchTo(engine: Engine): void {
    this.#pending = undefined;
    if (engine === this.#engine) return;
    const next = this.#create(engine);
    try {
      if (this.#gate) next.setKeyGate(this.#gate);
      if (this.#volume !== undefined) next.setVolume(this.#volume);
      if (this.#output !== undefined) void next.setOutputDevice(this.#output).catch(() => {});
      if (this.#capturing) next.captureText(true);
      if (this.#overlay) next.setOverlay?.(true);
    } catch (e) {
      try {
        next.dispose();
      } catch {
        // the half-built host is being thrown away anyway
      }
      throw e;
    }
    // The old host reports "home" while it goes, so the core's route is fresh; then nothing more is heard from it.
    this.#host.dispose();
    this.#stop();
    this.#engine = engine;
    this.#host = next;
    this.#stop = next.onEvent((e) => this.#emit(e));
    if (this.#visible) {
      try {
        next.show();
      } catch (e) {
        console.warn("[netflix] the new host couldn't show:", e);
      }
    }
    for (const l of Array.from(this.#switched)) l(engine);
  }

  /**
   * Switches quietly: at once when the App is hidden, else when it is next hidden, so a playing page is never
   * interrupted. Returns whether it switched now. A failure is logged and the old host stays.
   */
  switchWhenAway(engine: Engine): boolean {
    if (engine === this.#engine) {
      this.#pending = undefined;
      return true;
    }
    if (this.#visible) {
      this.#pending = engine;
      return false;
    }
    this.#quietly(engine);
    return this.#engine === engine;
  }

  #quietly(engine: Engine): void {
    try {
      this.switchTo(engine);
    } catch (e) {
      console.warn(`[netflix] couldn't switch to ${engine}:`, e);
    }
  }

  #emit(event: YouTubeEvent): void {
    for (const l of Array.from(this.#listeners)) l(event);
  }

  show(note?: string): void {
    this.#visible = true;
    this.#host.show(note);
  }
  hide(): void {
    this.#visible = false;
    this.#host.hide();
    const pending = this.#pending;
    if (pending) this.#quietly(pending);
  }
  start(): void {
    this.#host.start();
  }
  focus(): void {
    this.#host.focus();
  }
  setKeyGate(gate: KeyGate): void {
    this.#gate = gate;
    this.#host.setKeyGate(gate);
  }
  setOverlay(on: boolean): void {
    this.#overlay = on;
    this.#host.setOverlay?.(on);
  }
  sendKey(key: YouTubeKey): void {
    this.#host.sendKey(key);
  }
  scrollToTop(): void {
    this.#host.scrollToTop?.();
  }
  submitSearch(text: string): void {
    this.#host.submitSearch(text);
  }
  showSearchBar(text: string | undefined): void {
    this.#host.showSearchBar(text);
  }
  captureText(on: boolean): void {
    this.#capturing = on;
    this.#host.captureText(on);
  }
  playPause(): void {
    this.#host.playPause();
  }
  seekBy(seconds: number): void {
    this.#host.seekBy(seconds);
  }
  seekTo(seconds: number): void {
    this.#host.seekTo?.(seconds);
  }
  setTrack(kind: TrackKind, id: string): void {
    this.#host.setTrack?.(kind, id);
  }
  pressPrompt(id: PromptId): void {
    this.#host.pressPrompt?.(id);
  }
  setSpeed(speed: number): void {
    this.#host.setSpeed?.(speed);
  }
  showVolume(percent: number | undefined): void {
    this.#host.showVolume(percent);
  }
  showConfirm(confirm: Confirmation | undefined): void {
    this.#host.showConfirm(confirm);
  }
  setVolume(percent: number): void {
    this.#volume = percent;
    this.#host.setVolume(percent);
  }
  setOutputDevice(name: string | undefined): Promise<boolean> {
    this.#output = name;
    return this.#host.setOutputDevice(name);
  }
  get followsMacOutput(): boolean | undefined {
    return this.#host.followsMacOutput;
  }
  restart(): void {
    this.#host.restart();
  }
  unload(): void {
    this.#host.unload();
  }
  setAddons(ids: string[], note?: string): void {
    this.#host.setAddons(ids, note);
  }
  onEvent(listener: (event: YouTubeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}
