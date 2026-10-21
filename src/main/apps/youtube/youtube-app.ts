import type { Confirmation } from "../../../shared/protocol.ts";
import type { Clock } from "../../ports/clock.ts";
import type { YouTube } from "../../ports/youtube.ts";
import type { App, AppEvent, AppKey, AppTyping } from "../app.ts";

/** A Back sent to YouTube that changed no route within this long counts as already at home. */
const BACK_SETTLE_MS = 800;

/** YouTube as an App: the YouTube TV view plus what Back means on its pages. */
export class YouTubeApp implements App {
  readonly id = "youtube";
  readonly label = "YouTube";
  readonly showVolume = true;
  readonly showSkip = true;
  readonly typing: AppTyping;
  #port: YouTube;
  #clock: Clock;
  #home = true;
  #shorts = false;
  /** Back was sent to YouTube at this time and no route change has followed. */
  #backAt: number | undefined;
  #listeners = new Set<(event: AppEvent) => void>();

  constructor(port: YouTube, clock: Clock) {
    this.#port = port;
    this.#clock = clock;
    this.typing = {
      label: "Search YouTube",
      submitSearch: (text) => port.submitSearch(text),
      showSearchBar: (text) => port.showSearchBar(text),
      captureText: (on) => port.captureText(on),
    };
    port.onEvent((event) => {
      if (event.type !== "route") return this.#emit(event);
      this.#home = event.home;
      // YouTube's Back out of a Short leaves its guide open; close that too, back to where the Short began.
      if (this.#shorts && event.shorts === false && event.guideOpen && this.#backAt !== undefined) {
        this.#backAt = this.#clock.now();
        this.#port.sendKey("back");
      } else this.#backAt = undefined;
      this.#shorts = event.shorts === true;
    });
  }

  #emit(event: AppEvent): void {
    for (const l of [...this.#listeners]) l(event);
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
  seekBy(seconds: number) {
    this.#port.seekBy(seconds);
  }
  drawVolume(percent: number | undefined) {
    this.#port.showVolume(percent);
  }
  showConfirm(confirm: Confirmation | undefined) {
    this.#port.showConfirm(confirm);
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
  setAddons(ids: string[], note?: string) {
    this.#port.setAddons(ids, note);
  }
  onEvent(listener: (event: AppEvent) => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}
