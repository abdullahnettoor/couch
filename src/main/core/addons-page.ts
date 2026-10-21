import type { GridItem, ScreenPayload } from "../../shared/protocol.ts";
import { YOUTUBE_ADDONS } from "../apps/youtube/addons/index.ts";
import type { Store } from "../ports/store.ts";
import { enabledAddons, readChoices, writeChoice } from "../web/addon.ts";

const APP = "youtube";
const TOGGLE = "addons:toggle:";

export interface AddonsPageHost {
  store: Store;
  /** Runs exactly these add-ons in the web App and reloads its page. */
  apply(app: string, ids: string[]): void;
  toast(text: string): void;
  changed(): void;
}

/** Settings → YouTube add-ons: one row per add-on; OK turns it on or off. */
export class AddonsPage {
  #h: AddonsPageHost;

  constructor(host: AddonsPageHost) {
    this.#h = host;
  }

  payload(): NonNullable<ScreenPayload["addons"]> {
    const on = new Set(
      enabledAddons(YOUTUBE_ADDONS, readChoices(this.#h.store, APP)).map((a) => a.id),
    );
    return YOUTUBE_ADDONS.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      on: on.has(a.id),
    }));
  }

  grid(): GridItem[] {
    return YOUTUBE_ADDONS.map((a, r) => ({
      id: a.id,
      r,
      c: 0,
      label: a.label,
      action: `${TOGGLE}${a.id}`,
      ...(r === 0 ? { initial: true } : {}),
    }));
  }

  action(action: string): boolean {
    if (!action.startsWith(TOGGLE)) return false;
    const id = action.slice(TOGGLE.length);
    const row = this.payload().find((a) => a.id === id);
    if (!row) return true;
    writeChoice(this.#h.store, YOUTUBE_ADDONS, APP, id, !row.on);
    this.#h.apply(
      APP,
      enabledAddons(YOUTUBE_ADDONS, readChoices(this.#h.store, APP)).map((a) => a.id),
    );
    this.#h.toast(`${row.label} is ${row.on ? "off" : "on"}`);
    return true;
  }
}
