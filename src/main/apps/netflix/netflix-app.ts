import type { Confirmation, TrackKind } from "../../../shared/protocol.ts";
import type { Clock } from "../../ports/clock.ts";
import type { YouTube } from "../../ports/youtube.ts";
import type { App, AppEvent, AppKey, AppTyping } from "../app.ts";

/** A Back sent to Netflix that changed no route within this long counts as already at home. */
const BACK_SETTLE_MS = 800;

/**
 * Netflix as an App. Back goes back in the page's history (that closes the player and the title
 * modal, and walks back out of search and genres); at its home, core asks "Leave Netflix?".
 */
export class NetflixApp implements App {
  readonly id = "netflix";
  readonly label = "Netflix";
  readonly showVolume = true;
  readonly showSkip = true;
  readonly typing: AppTyping;
  #port: YouTube;
  #clock: Clock;
  #home = true;
  #scrolled = false;
  #route: string | undefined;
  /** Back was sent to Netflix at this time and no route change has followed. */
  #backAt: number | undefined;
  #listeners = new Set<(event: AppEvent) => void>();

  constructor(port: YouTube, clock: Clock) {
    this.#port = port;
    this.#clock = clock;
    this.typing = {
      label: "Search Netflix",
      submitSearch: (text) => port.submitSearch(text),
      showSearchBar: (text) => port.showSearchBar(text),
      captureText: (on) => port.captureText(on),
    };
    port.onEvent((event) => {
      if (event.type !== "route") return this.#emit(event);
      // The host re-checks the page often; only a real change of route is news.
      const key = `${event.home}|${event.scrolled === true}|${event.url ?? ""}`;
      if (key === this.#route) return;
      this.#route = key;
      this.#home = event.home;
      this.#scrolled = event.scrolled === true;
      this.#backAt = undefined;
    });
  }

  #emit(event: AppEvent): void {
    for (const l of [...this.#listeners]) l(event);
  }

  back(): "leave" | "handled" {
    if (this.#scrolled && this.#port.scrollToTop) {
      this.#port.scrollToTop();
      return "handled";
    }
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
  seekTo(seconds: number) {
    this.#port.seekTo?.(seconds);
  }
  setTrack(kind: TrackKind, id: string) {
    this.#port.setTrack?.(kind, id);
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
  onEvent(listener: (event: AppEvent) => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }
}
