import {
  VIEW_LABELS,
  type GridItem,
  type ScreenPayload,
  type View,
} from "../../../shared/protocol.ts";
import { SETTINGS_APP } from "../../../shared/settings-grid.ts";
import type { AppEntry } from "../../apps/index.ts";
import { APPS_MENU_KEY, type HomeApps } from "../home-apps.ts";
import { backTo, type Page, type PageBack, type PageContext } from "./page.ts";

export interface SettingsAppsHost {
  homeApps: Pick<
    HomeApps,
    "menuId" | "menuGrid" | "grid" | "action" | "closeMenu" | "resetMenu" | "menuRow"
  >;
  catalog(): AppEntry[];
  /** The YouTube add-ons and whether each is on. */
  addons(): NonNullable<ScreenPayload["addons"]>;
}

/** Settings → Apps: one row per App, and over it the menu of the App that was chosen (its own focus, its own Back). */
export class SettingsAppsPage implements Page {
  #ctx: PageContext;
  #h: SettingsAppsHost;

  constructor(ctx: PageContext, host: SettingsAppsHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  focusKey(): string | undefined {
    return this.#h.homeApps.menuId ? APPS_MENU_KEY : undefined;
  }

  grid(): GridItem[] {
    const apps = this.#h.homeApps;
    return apps.menuId ? apps.menuGrid() : apps.grid((id) => `${SETTINGS_APP}${id}`);
  }

  payload(): Partial<ScreenPayload> {
    const id = this.#h.homeApps.menuId;
    const app = this.#h.catalog().find((a) => a.id === id);
    return {
      addons: this.#h.addons(),
      ...(app ? { appMenu: { id: app.id, label: app.label } } : {}),
    };
  }

  action(action: string): boolean {
    return this.#h.homeApps.action(action);
  }

  /** The Apps list or its menu changed: focus follows the open menu's App in the list behind it. */
  changed(): void {
    const at = this.#h.homeApps.menuRow();
    if (at >= 0) this.#ctx.setFocus("settingsApps", { r: at, c: 0 });
  }

  /** The menu is forgotten on leaving, except into the Add-ons page it opens, which goes back to it. */
  leave(to: View): void {
    if (to !== "addons") this.forgetMenu();
  }

  forgetMenu(): void {
    this.#h.homeApps.resetMenu();
    this.#ctx.setFocus(APPS_MENU_KEY);
  }

  back(): PageBack {
    if (this.#h.homeApps.menuId) {
      return {
        label: VIEW_LABELS.settingsApps,
        act: () => {
          this.#ctx.setFocus(APPS_MENU_KEY);
          this.#h.homeApps.closeMenu();
        },
      };
    }
    return backTo(this.#ctx, "settings");
  }
}
