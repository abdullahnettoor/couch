import type { Confirmation } from "../../../shared/protocol.ts";
import type { Clock } from "../../ports/clock.ts";
import type { YouTube } from "../../ports/youtube.ts";
import type { App, AppEvent, AppKey } from "../app.ts";
import type { TextSize } from "../../web/text-size.ts";

/** A Back sent to BitChord that changed no route within this long counts as already at its first page. */
const BACK_SETTLE_MS = 800;

/** BitChord as an App: Back goes back in the page's history, and leaves to Home from its first page. */
export class BitChordApp implements App {
  readonly id = "bitchord";
  readonly label = "BitChord";
  readonly showVolume = true;
  readonly showSkip = false;
  #port: YouTube;
  #clock: Clock;
  #home = true;
  #route: string | undefined;
  #backAt: number | undefined;
  #listeners = new Set<(event: AppEvent) => void>();

  constructor(port: YouTube, clock: Clock) {
    this.#port = port;
    this.#clock = clock;
    port.onEvent((event) => {
      if (event.type === "backHandled") {
        this.#backAt = undefined;
        return;
      }
      if (event.type !== "route") return this.#emit(event);
      const key = `${event.home}|${event.url ?? ""}`;
      if (key === this.#route) return;
      this.#route = key;
      this.#home = event.home;
      this.#backAt = undefined;
    });
  }

  #emit(event: AppEvent): void {
    for (const l of this.#listeners) l(event);
  }

  back(): "leave" | "handled" {
    const now = this.#clock.now();
    const stuck = this.#backAt !== undefined && now - this.#backAt >= BACK_SETTLE_MS;
    if (this.#home || stuck) {
      this.#backAt = undefined;
      return "leave";
    }
    this.#backAt = now;
    this.#port.sendKey("back");
    return "handled";
  }

  show(note?: string) {
    this.#port.show(note);
  }
  hide() {
    this.#port.hide();
  }
  sendKey(key: AppKey) {
    this.#port.sendKey(key);
  }
  playPause() {
    this.#port.playPause();
  }
  get supportsTextSize(): boolean {
    return this.#port.supportsTextSize === true;
  }
  setTextSize(size: TextSize) {
    this.#port.setTextSize?.(size);
  }
  drawVolume(percent: number | undefined) {
    this.#port.showVolume(percent);
  }
  showConfirm(confirm: Confirmation | undefined) {
    this.#port.showConfirm(confirm);
  }
  get followsMacOutput() {
    return this.#port.followsMacOutput;
  }
  setVolume(percent: number) {
    this.#port.setVolume(percent);
  }
  setOutputDevice(name: string | undefined) {
    return this.#port.setOutputDevice(name);
  }
  restart() {
    this.#port.restart();
  }
  onEvent(listener: (event: AppEvent) => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}
