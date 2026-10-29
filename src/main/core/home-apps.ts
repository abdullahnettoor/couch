import { RESTART_APP, type AppEntry } from "../apps/index.ts";
import type { GridItem, View } from "../../shared/protocol.ts";
import type { Store } from "../ports/store.ts";

const KEY = "home.apps";
export const HOME_APP = "home:";
export const SIGN_IN_APP = "app:signin:";
export const PLAYBACK_APP = "app:playback:";
/** The menu's own focus, kept apart from the list behind it. */
export const APPS_MENU_KEY = "settingsApps:menu";

export interface HomeAppRow {
  id: string;
  label: string;
  icon: string;
  shown: boolean;
}

interface Stored {
  order: string[];
  hidden: string[];
}

/**
 * Every App in the household's order with whether Home shows it (Store key `home.apps`, the file
 * `home.apps.json`). Startup and Core both read it here, so they always agree:
 * new Apps go last and shown, unknown ids are dropped, hidden applies only to ids in the stored
 * order, and when everything is hidden the first App is shown.
 */
export function resolveHomeApps(
  store: Store,
  catalog: Array<Pick<AppEntry, "id" | "label" | "icon">>,
): HomeAppRow[] {
  const raw = store.read<Partial<Stored> | null>(KEY, {}) ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const byId = new Map(catalog.map((k) => [k.id, k]));
  const ids = [...new Set<string>(list(raw.order))].filter((id) => byId.has(id));
  const hidden = new Set(list(raw.hidden).filter((id) => ids.includes(id)));
  for (const k of catalog) if (!ids.includes(k.id)) ids.push(k.id);
  const rows = ids.map((id) => {
    const k = byId.get(id)!;
    return { id, label: k.label, icon: k.icon, shown: !hidden.has(id) };
  });
  if (rows.length && !rows.some((r) => r.shown)) rows[0]!.shown = true;
  return rows;
}

const LIBRARY_VIEWS: View[] = [
  "library",
  "folder",
  "libraryFolders",
  "librarySearch",
  "show",
  "fixMatch",
  "player",
];

/** Whether hiding App `id` must take the Screen Home first: the Library owns its views, a web App owns `app`. */
export function leavesOnHide(id: string, view: View, openApp: string | undefined): boolean {
  if (view === "app") return openApp === id;
  return id === "library" && LIBRARY_VIEWS.includes(view);
}

export interface HomeAppsHost {
  store: Store;
  /** Every App Couch has (injected ones too), in its default order. */
  known(): AppEntry[];
  toast(text: string): void;
  /** An App was hidden: core leaves it first if it is open. */
  hidden(id: string): void;
  changed(): void;
  /** The engine App `id` plays with now, when it offers a choice. */
  /** The engine in use, and why the other can't be used when it can't. */
  playback(id: string): { label: string; unavailable?: string } | undefined;
  /** Whether App `id` offers Sign out (and Copy sign-in from Couch). */
  hasSignIn(id: string): boolean;
  /** Whether App `id` can copy a sign-in from Couch's Chromium engine right now (it holds one). */
  hasCouchCopy(id: string): boolean;
}

/** Which Apps Home shows and in what order; Settings → Apps edits it, through a menu over the list. */
export class HomeApps {
  #h: HomeAppsHost;
  #menu: string | undefined;

  constructor(host: HomeAppsHost) {
    this.#h = host;
  }

  rows(): HomeAppRow[] {
    return resolveHomeApps(this.#h.store, this.#h.known());
  }

  isShown(id: string): boolean {
    return this.rows().find((r) => r.id === id)?.shown ?? false;
  }

  /** Home's App ids in order, hidden ones left out. */
  shownIds(): string[] {
    return this.rows()
      .filter((r) => r.shown)
      .map((r) => r.id);
  }

  /** The App whose menu is open over the Apps list. */
  get menuId(): string | undefined {
    return this.#menu;
  }

  openMenu(id: string): void {
    if (!this.rows().some((r) => r.id === id)) return;
    this.#menu = id;
    this.#h.changed();
  }

  closeMenu(): void {
    if (this.#menu === undefined) return;
    this.#menu = undefined;
    this.#h.changed();
  }

  /** Forgets the menu without a redraw (the view is changing anyway). */
  resetMenu(): void {
    this.#menu = undefined;
  }

  /** The row index of the open menu's App in the list behind it. */
  menuRow(): number {
    return this.rows().findIndex((r) => r.id === this.#menu);
  }

  setShown(id: string, shown: boolean): boolean {
    const rows = this.rows();
    const row = rows.find((r) => r.id === id);
    if (!row || row.shown === shown) return !!row;
    if (!shown && rows.filter((r) => r.shown).length <= 1) {
      this.#h.toast("Keep at least one App on Home");
      return false;
    }
    row.shown = shown;
    this.#save(rows);
    if (!shown) this.#h.hidden(id);
    this.#h.changed();
    return true;
  }

  move(id: string, by: -1 | 1): void {
    const rows = this.rows();
    const at = rows.findIndex((r) => r.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= rows.length) return;
    [rows[at], rows[to]] = [rows[to]!, rows[at]!];
    this.#save(rows);
    this.#h.changed();
  }

  #save(rows: HomeAppRow[]): void {
    this.#h.store.write(KEY, {
      order: rows.map((r) => r.id),
      hidden: rows.filter((r) => !r.shown).map((r) => r.id),
    } satisfies Stored);
  }

  /** Settings → Apps: one row per App, in Home order. */
  grid(open: (id: string) => string): GridItem[] {
    return this.rows().map((r, i) => ({
      id: r.id,
      r: i,
      c: 0,
      label: r.label,
      action: open(r.id),
      ...(i === 0 ? { initial: true } : {}),
    }));
  }

  /** The open menu: show or hide, the two moves, then Restart (web) and Add-ons. */
  menuGrid(): GridItem[] {
    const id = this.#menu ?? "";
    const entry = this.#h.known().find((e) => e.id === id);
    const shown = this.isShown(id);
    const playback = this.#h.playback(id);
    const items: Array<Omit<GridItem, "r" | "c">> = [
      {
        id: "home-toggle",
        label: shown ? "Hide from Home" : "Show on Home",
        action: `${HOME_APP}${shown ? "hide" : "show"}:${id}`,
      },
      { id: "home-up", label: "Move up", action: `${HOME_APP}move:-1:${id}` },
      { id: "home-down", label: "Move down", action: `${HOME_APP}move:1:${id}` },
      ...(entry?.web
        ? [{ id: "restart", label: `Restart ${entry.label}`, action: `${RESTART_APP}${entry.id}` }]
        : []),
      ...(playback
        ? [
            {
              id: "playback",
              label: `Playback: ${playback.label}${playback.unavailable ? ` · ${playback.unavailable}` : ""}`,
              action: `${PLAYBACK_APP}${id}`,
            },
          ]
        : []),
      ...(this.#h.hasSignIn(id)
        ? [
            ...(this.#h.hasCouchCopy(id)
              ? [
                  {
                    id: "sign-in-couch",
                    label: "Copy sign-in from Couch",
                    action: `${SIGN_IN_APP}couch:${id}`,
                  },
                ]
              : []),
            { id: "sign-in-out", label: "Sign out", action: `${SIGN_IN_APP}out:${id}` },
          ]
        : []),
      ...(entry?.addons ? [{ id: "addons", label: "Add-ons", action: "settings:addons" }] : []),
    ];
    return items.map((item, r) => ({ ...item, r, c: 0, ...(r === 0 ? { initial: true } : {}) }));
  }

  action(action: string): boolean {
    if (!action.startsWith(HOME_APP)) return false;
    const [verb, ...rest] = action.slice(HOME_APP.length).split(":");
    if (verb === "show" || verb === "hide") this.setShown(rest[0] ?? "", verb === "show");
    else if (verb === "move") this.move(rest[1] ?? "", rest[0] === "-1" ? -1 : 1);
    else return false;
    return true;
  }
}
