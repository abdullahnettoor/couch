import { liveListener, systemProbe, type ListenerProbe } from "../listener.ts";
import type { Mac } from "../ports/mac.ts";
import type { Store } from "../ports/store.ts";

export interface ListenerLoginHost {
  mac: Mac;
  store: Store;
  probe?: ListenerProbe;
  /** Moves the Remote server out of the listener's way and back when the login item is toggled while Couch runs. */
  frontdoor?: { beforeEnable(): Promise<void>; afterChange(on: boolean): Promise<void> };
  changed(): void;
}

/** The listener's login item on the Mac, and whether a listener is really up. */
export class ListenerLogin {
  #h: ListenerLoginHost;
  item = { available: false, on: false, running: false };

  constructor(host: ListenerLoginHost) {
    this.#h = host;
  }

  /** Reads the login item and whether a listener is really up (status file, pid, port) from the Mac. */
  async refresh(): Promise<void> {
    const item = await this.#h.mac.listenerLoginItem().catch(() => this.item);
    const running =
      item.available &&
      !!(await liveListener(this.#h.store, this.#h.probe ?? systemProbe).catch(() => undefined));
    this.item = { available: item.available, on: item.on, running };
    this.#h.changed();
  }

  async turnOn(): Promise<void> {
    await this.refresh();
    if (!this.item.on) await this.toggle();
  }

  async toggle(): Promise<void> {
    await this.refresh();
    if (!this.item.available) return;
    const turnOn = !this.item.on;
    const door = this.#h.frontdoor;
    if (turnOn) await door?.beforeEnable().catch(() => {});
    await this.#h.mac.setListenerLoginItem(turnOn).catch(() => {});
    await this.refresh();
    await door?.afterChange(this.item.on).catch(() => {});
    await this.refresh();
  }
}
