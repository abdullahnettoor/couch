import {
  VIEW_LABELS,
  type GridItem,
  type RemoteNote,
  type ScreenPayload,
  type View,
} from "../../../shared/protocol.ts";
import { SETTINGS_APP } from "../../../shared/settings-grid.ts";
import { RESTART_APP, type AppEntry } from "../../apps/index.ts";
import { availableWithin } from "../../apps/availability.ts";
import { copyFromCouchToast } from "../../apps/sign-in-text.ts";
import { PlaybackUnavailable, type App } from "../../apps/app.ts";
import { APPS_MENU_KEY, PLAYBACK_APP, SIGN_IN_APP, type HomeApps } from "../home-apps.ts";
import { backTo, type Page, type PageBack, type PageContext } from "./page.ts";

export interface SettingsAppsHost {
  homeApps: Pick<
    HomeApps,
    "menuId" | "menuGrid" | "grid" | "action" | "closeMenu" | "resetMenu" | "menuRow" | "openMenu"
  >;
  apps: ReadonlyMap<string, App>;
  /** An App that failed to load is let try again. */
  clearFailure(id: string): void;
  catalog(): AppEntry[];
  /** The YouTube add-ons and whether each is on. */
  addons(): NonNullable<ScreenPayload["addons"]>;
}

/** Settings → Apps: one row per App, and over it the menu of the App that was chosen (its own focus, its own Back). */
export class SettingsAppsPage implements Page {
  #ctx: PageContext;
  #h: SettingsAppsHost;
  /** Apps whose Couch-Chromium sign-in exists, asked each time their menu opens. */
  #couchCopy = new Set<string>();
  #couchCheck = 0;

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
    if (this.#h.homeApps.action(action)) return true;
    if (action.startsWith(SETTINGS_APP)) {
      const id = action.slice(SETTINGS_APP.length);
      // The row waits for a fresh answer: an old one may be stale (the cookies can be gone).
      this.#couchCopy.delete(id);
      this.#h.homeApps.openMenu(id);
      void this.#refreshCouchCopy(id);
      return true;
    }
    if (action.startsWith(SIGN_IN_APP)) {
      const [verb, id = ""] = action.slice(SIGN_IN_APP.length).split(":");
      if (verb === "couch") void this.#copySignInFromCouch(id);
      else if (verb === "out") void this.#signOut(id);
      else return false;
      return true;
    }
    if (action.startsWith(PLAYBACK_APP)) {
      void this.#switchPlayback(action.slice(PLAYBACK_APP.length));
      return true;
    }
    if (action.startsWith(RESTART_APP)) {
      this.#restart(action.slice(RESTART_APP.length));
      return true;
    }
    return false;
  }

  /** Whether the App's menu offers copying its sign-in from Couch's Chromium engine. */
  hasCouchCopy(id: string): boolean {
    return this.#couchCopy.has(id);
  }

  /** The card the Remote shows under an App's menu: why the other playback engine isn't offered. */
  remoteNote(): RemoteNote | undefined {
    const id = this.#h.homeApps.menuId;
    const reason = id ? this.#h.apps.get(id)?.playback?.unavailable : undefined;
    return reason ? { title: "Playback", steps: [reason] } : undefined;
  }

  async #refreshCouchCopy(id: string): Promise<void> {
    const copy = this.#h.apps.get(id)?.signIn?.copyFromCouch;
    if (!copy) return;
    const check = ++this.#couchCheck;
    const has = await availableWithin(() => copy.available());
    if (check !== this.#couchCheck) return;
    if (has === this.#couchCopy.has(id)) return;
    if (has) this.#couchCopy.add(id);
    else this.#couchCopy.delete(id);
    this.#ctx.emit();
  }

  /** Copy sign-in from Couch. The App reads Couch's Chromium engine; this only hears how it went. */
  async #copySignInFromCouch(id: string): Promise<void> {
    const app = this.#h.apps.get(id);
    const copy = app?.signIn?.copyFromCouch;
    if (!app || !copy) return;
    const result = await copy.copy().catch(() => ({ ok: false, reason: "failed" }) as const);
    const toast = copyFromCouchToast(app.label, result);
    if (toast) this.#ctx.toast(toast);
    this.#ctx.emit();
  }

  /** Playback: the App swaps to its other engine; the rows and notes that depend on it are redrawn. */
  async #switchPlayback(id: string): Promise<void> {
    const app = this.#h.apps.get(id);
    const playback = app?.playback;
    if (!app || !playback) return;
    const now = playback.current();
    const next = playback.options.find((o) => o.id !== now.id);
    if (!next) return;
    this.#couchCopy.delete(id);
    const failure = await playback.select(next.id).then(
      () => undefined,
      (e: unknown) => e,
    );
    this.#ctx.toast(
      failure === undefined
        ? `${app.label} now plays with ${next.label}`
        : failure instanceof PlaybackUnavailable
          ? failure.message
          : `Couldn't switch ${app.label}'s playback`,
    );
    this.#ctx.emit();
    void this.#refreshCouchCopy(id);
  }

  async #signOut(id: string): Promise<void> {
    const app = this.#h.apps.get(id);
    if (!app?.signIn) return;
    const done = await app.signIn.signOut().then(
      () => true,
      () => false,
    );
    this.#ctx.toast(done ? `Signed out of ${app.label}` : `Couldn't sign out of ${app.label}`);
    this.#ctx.emit();
  }

  #restart(id: string): void {
    const app = this.#h.apps.get(id);
    if (!app) return;
    this.#h.clearFailure(id);
    app.restart();
    this.#ctx.toast(`Restarting ${app.label}`);
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
