import type { GridItem, ScreenPayload, View } from "../../../shared/protocol.ts";
import { YOUTUBE_ADDONS } from "../../apps/youtube/addons/index.ts";
import type { Page, PageBack, PageContext } from "./page.ts";
import type { Store } from "../../ports/store.ts";
import { enabledAddons, readChoices, writeChoice } from "../../web/addon.ts";

const APP = "youtube";
const TOGGLE = "addons:toggle:";

export interface AddonsPageHost {
  store: Store;
  /** Runs exactly these add-ons in the web App and reloads its page; `note` is shown over it (when it is in front). */
  apply(app: string, ids: string[], note?: string): void;
  /** The App is on the Screen now. */
  isFront(app: string): boolean;
  /** Settings → Apps forgets its open menu. */
  forgetMenu(): void;
}

/** Settings → YouTube add-ons: one row per add-on; OK turns it on or off. */
export class AddonsPage implements Page {
  #ctx: PageContext;
  #h: AddonsPageHost;

  constructor(ctx: PageContext, host: AddonsPageHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  back(): PageBack {
    return { label: "YouTube", act: () => this.#ctx.go("settingsApps") };
  }

  /** Back goes to Settings → Apps, with the App's menu still open; anywhere else forgets that menu. */
  leave(to: View): void {
    if (to !== "settingsApps") this.#h.forgetMenu();
  }

  payload(): Pick<ScreenPayload, "addons"> {
    return { addons: this.rows() };
  }

  /** One row per add-on with whether it is on; Settings → Apps shows them too. */
  rows(): NonNullable<ScreenPayload["addons"]> {
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
    this.toggle(action.slice(TOGGLE.length));
    return true;
  }

  /** Turns one add-on on or off: Store, then the App reloads (with the note over it when it is in front). */
  toggle(id: string): void {
    const row = this.rows().find((a) => a.id === id);
    if (!row) return;
    writeChoice(this.#h.store, YOUTUBE_ADDONS, APP, id, !row.on);
    const note = `${row.label} is ${row.on ? "off" : "on"}`;
    this.#h.apply(
      APP,
      enabledAddons(YOUTUBE_ADDONS, readChoices(this.#h.store, APP)).map((a) => a.id),
      this.#h.isFront(APP) ? note : undefined,
    );
    this.#ctx.toast(note);
  }
}
