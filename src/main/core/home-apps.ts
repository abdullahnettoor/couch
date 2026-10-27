import type { GridItem } from "../../shared/protocol.ts";
import type { Store } from "../ports/store.ts";

const KEY = "home.apps";
export const HOME_APP = "home:";

export interface HomeAppRow {
  id: string;
  label: string;
  shown: boolean;
}

interface Stored {
  order: string[];
  hidden: string[];
}

export interface HomeAppsHost {
  store: Store;
  /** Every App Couch has, in its default order. */
  known(): Array<{ id: string; label: string }>;
  toast(text: string): void;
  /** An App was hidden: core leaves it first if it is open. */
  hidden(id: string): void;
  changed(): void;
}

/** Which Apps Home shows and in what order (Store key `home.apps`); Settings → Apps edits it. */
export class HomeApps {
  #h: HomeAppsHost;

  constructor(host: HomeAppsHost) {
    this.#h = host;
  }

  #stored(): Stored {
    const raw = this.#h.store.read<Partial<Stored>>(KEY, {});
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    return { order: list(raw.order), hidden: list(raw.hidden) };
  }

  /** Every known App in the stored order (new ones at the end); unknown stored ids are dropped. */
  rows(): HomeAppRow[] {
    const known = this.#h.known();
    const stored = this.#stored();
    const byId = new Map(known.map((k) => [k.id, k]));
    const ids = [...new Set(stored.order)].filter((id) => byId.has(id));
    for (const k of known) if (!ids.includes(k.id)) ids.push(k.id);
    const hidden = new Set(stored.hidden);
    const rows = ids.map((id) => ({ id, label: byId.get(id)!.label, shown: !hidden.has(id) }));
    if (rows.length && !rows.some((r) => r.shown)) rows[0]!.shown = true;
    return rows;
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

  /** The rows on one App's page: show or hide, then the two moves. */
  pageItems(id: string): Array<{ id: string; label: string; action: string }> {
    const shown = this.isShown(id);
    return [
      {
        id: "home-toggle",
        label: shown ? "Hide from Home" : "Show on Home",
        action: `${HOME_APP}${shown ? "hide" : "show"}:${id}`,
      },
      { id: "home-left", label: "Move left", action: `${HOME_APP}move:-1:${id}` },
      { id: "home-right", label: "Move right", action: `${HOME_APP}move:1:${id}` },
    ];
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
