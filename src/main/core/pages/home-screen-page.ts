import { basename, dirname } from "node:path";
import type { GridItem, LibraryEntry, ScreenPayload } from "../../../shared/protocol.ts";
import { homeItems } from "../../../shared/home-grid.ts";
import type { AppEntry } from "../../apps/index.ts";
import type { App, NowPlayingHint } from "../../apps/app.ts";
import { resolveFocus } from "../focus.ts";
import { filmAfterFocus, homeGrid } from "../home-view.ts";
import { fromStartUrl, titleId, titleKey, type ContinueApps } from "../continue-apps.ts";
import type { ContinueArt } from "../continue-art.ts";
import type { History } from "../history.ts";
import type { HomeApps } from "../home-apps.ts";
import { hueFor, presentation } from "../library.ts";
import { topGenres } from "../library-rows.ts";
import type { PathArt } from "../art.ts";
import type { ThumbnailScheduler } from "../thumbnail-scheduler.ts";
import type { Page, PageBack, PageContext } from "./page.ts";

/** Home's update icon, in the top strip left of the gear (as the Library's search icon is). */
const UPDATE_ICON: GridItem = {
  id: "update",
  r: 0,
  c: -1,
  label: "Update ready",
  action: "open:update",
};

/** Home's row fits this many tiles: its App tiles, then Continue watching. */
const HOME_ROW_TILES = 5;

/** What Home asks of the core, besides the Page context. */
export interface HomeScreenHost {
  catalog(): AppEntry[];
  apps: ReadonlyMap<string, App>;
  homeApps: HomeApps;
  history: History;
  appTitles: ContinueApps;
  continueArt: ContinueArt | undefined;
  thumbs: ThumbnailScheduler;
  updateReady(): boolean;
  art(path: string): PathArt;
  still(path: string, frame: (p: string) => string | undefined): string | undefined;
  decorate(entry: LibraryEntry): LibraryEntry;
  /** The Library's chip goes back to All when Home opens. */
  resetChip(): void;
  /** What Fix match offers for a Library film, or undefined. */
  fixTargetFor(entry: LibraryEntry): string | undefined;
  openFixFromHome(target: string): void;
  setHint(appId: string, hint: NowPlayingHint): void;
  openApp(id: string, at?: string): void;
  play(path: string, fromStart: boolean): void;
}

/**
 * Home: its grid (the base, Resume and From start, the App tiles, Continue watching cut to the row),
 * the film shown in the hero, the hero field, and resetting itself on entering.
 * Ambient Home stays in the core, because it reacts to input across every Page.
 */
export class HomeScreenPage implements Page {
  #ctx: PageContext;
  #h: HomeScreenHost;
  /** The film card whose backdrop shows (focused, or last focused while Resume / From start has focus). */
  #film: string | undefined;

  constructor(ctx: PageContext, host: HomeScreenHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  back(): PageBack | undefined {
    return undefined;
  }

  action(): boolean {
    return false;
  }

  /** Home opens fresh: the Library's chip back to All, no remembered focus or film. */
  #reset(): void {
    this.#h.resetChip();
    this.#ctx.setFocus("home");
    this.#film = undefined;
  }

  enter(): void {
    this.#reset();
  }

  /** Going Home while already on Home starts it over too. */
  reenter(): void {
    this.#reset();
  }

  /** Home's gear and the catalog's Apps, cut to the shown Apps in the household's order; the update icon left of the gear while an update is ready. */
  #base(): GridItem[] {
    const reported = homeItems(this.#h.catalog());
    const apps = new Map(reported.filter((i) => i.id !== "settings").map((i) => [i.id, i]));
    const ordered = this.#h.homeApps.shownIds().flatMap((id) => apps.get(id) ?? []);
    return [
      ...(this.#h.updateReady() ? [UPDATE_ICON] : []),
      ...reported.filter((i) => i.id === "settings"),
      ...ordered.map((i, c) => {
        const { initial: _initial, ...item } = i;
        return { ...item, c, ...(c === 0 ? { initial: true } : {}) };
      }),
    ];
  }

  grid(): GridItem[] {
    const base = this.#base();
    const videos = base.length ? this.continueRow() : [];
    const gridFor = () =>
      homeGrid(
        base,
        videos,
        videos.find((v) => v.path === this.#film),
      );
    let grid = gridFor();
    this.#film = filmAfterFocus(
      resolveFocus(grid, this.#ctx.focusOf("home"))?.id,
      videos,
      this.#film,
    );
    grid = gridFor();
    return grid;
  }

  payload(): Partial<ScreenPayload> {
    return { hero: this.continueRow().find((v) => v.path === this.#film) };
  }

  /** Back on Home after a video started there: focus returns to its card, so its backdrop shows. */
  focusCard(path: string): void {
    const videos = this.continueRow();
    const film = videos.find((v) => v.path === path);
    const card = homeGrid(this.#base(), videos, film).find((i) => i.id === path);
    this.#film = card ? path : undefined;
    this.#ctx.setFocus("home", card ? { r: card.r, c: card.c } : undefined);
  }

  /** Home's Continue watching and the Remote's card: Library videos and App titles together, newest first. */
  entries(): LibraryEntry[] {
    const videos = this.#libraryContinue();
    const titles = this.#appContinue();
    if (!titles.length) return videos.map((v) => v.entry);
    return [...videos, ...titles].sort((a, b) => b.at - a.at).map((v) => v.entry);
  }

  /**
   * Home's Continue watching: the newest entry of each App and of the Library, newest first,
   * as many as fit in the row beside the App tiles (at least one).
   */
  continueRow(): LibraryEntry[] {
    const seen = new Set<string>();
    const newest = this.entries().filter((e) => {
      const source = e.app?.id ?? "library";
      if (seen.has(source)) return false;
      seen.add(source);
      return true;
    });
    return newest.slice(0, Math.max(1, HOME_ROW_TILES - this.#h.homeApps.shownIds().length));
  }

  /** The Library's own row: its in-progress videos only. */
  libraryEntries(): LibraryEntry[] {
    return this.#libraryContinue().map((v) => v.entry);
  }

  /** Each remembered App title, as a Continue watching entry, unless its App is hidden or gone. */
  #appContinue(): Array<{ at: number; entry: LibraryEntry }> {
    return this.#h.appTitles.entries().flatMap((e) => {
      const app = this.#h.apps.get(e.app);
      const icon = this.#h.catalog().find((c) => c.id === e.app)?.icon;
      if (!app || !icon || !this.#h.homeApps.isShown(e.app)) return [];
      const art = this.#h.continueArt;
      const fraction = Math.min(1, e.position / e.duration);
      const left = Math.max(1, Math.ceil((e.duration - e.position) / 60));
      return [
        {
          at: e.at,
          entry: {
            kind: "video",
            path: `app:${e.app}:${titleKey(e.url)}`,
            title: e.title,
            hue: hueFor(e.title),
            folder: app.label,
            ...(e.art && art?.fileUrl(e.art) ? { thumb: art.fileUrl(e.art) } : {}),
            progress: { fraction, left: `${left} min left` },
            app: {
              id: e.app,
              label: app.label,
              icon,
              fromStart: fromStartUrl(e.url) !== e.url,
            },
          } satisfies LibraryEntry,
        },
      ];
    });
  }

  #libraryContinue(): Array<{ at: number; entry: LibraryEntry }> {
    if (!this.#h.homeApps.isShown("library")) return [];
    return this.#h.history.continueWatching().map((c) => {
      const { title, line } = presentation(c.path);
      const { details, episode } = this.#h.art(c.path);
      const thumb = this.#h.still(c.path, (p) => this.#h.thumbs.lookup(p));
      return {
        at: c.at,
        entry: this.#h.decorate({
          kind: "video",
          path: c.path,
          title: episode?.name ?? title,
          ...(line ? { line } : {}),
          hue: hueFor(title),
          folder: basename(dirname(c.path)),
          thumb,
          ...(details?.backdrop ? { backdrop: details.backdrop } : {}),
          ...(details?.genres?.length ? { genres: topGenres(details) } : {}),
          ...((episode?.overview ?? details?.overview)
            ? { overview: episode?.overview ?? details?.overview }
            : {}),
        }),
      };
    });
  }

  /** The entry a Continue watching id (`app:<id>:<key>`) names, if it is still remembered. */
  titleFor(path: string): { app: string; key: string } | undefined {
    const m = /^app:([^:]+):(.+)$/.exec(path);
    return m ? { app: m[1]!, key: m[2]! } : undefined;
  }

  /** The phone fetches an App entry's picture by key, like a Library thumbnail. */
  artKey(path: string): { thumbKey?: string } {
    const id = this.titleFor(path);
    const art = id && this.#h.appTitles.find(id.app, id.key)?.art;
    return art && this.#h.continueArt?.has(art) ? { thumbKey: art } : {};
  }

  /** A Continue watching entry: a Library video, or an App title that reopens its App. */
  playContinue(path: string, fromStart = false): void {
    if (this.titleFor(path)) this.#resumeTitle(path, fromStart);
    else this.#h.play(path, fromStart);
  }

  /** Opens the App at where the remembered title was left (`fromStart`: at its beginning, for an App whose address carries the time). */
  #resumeTitle(path: string, fromStart: boolean): void {
    const id = this.titleFor(path);
    const entry = id && this.#h.appTitles.find(id.app, id.key);
    const app = id && this.#h.apps.get(id.app);
    if (!entry || !app || !this.#h.homeApps.isShown(entry.app)) return;
    const hintId = titleId(entry.url);
    if (hintId)
      this.#h.setHint(entry.app, {
        id: hintId,
        title: entry.title,
        ...(entry.art && this.#h.continueArt?.has(entry.art) ? { artKey: entry.art } : {}),
      });
    this.#h.openApp(entry.app, fromStart ? fromStartUrl(entry.url) : entry.url);
  }

  /** Removes an entry from Continue watching: an App title for good, a Library video's saved position. */
  forget(path: string | undefined): void {
    // Only what Continue watching shows right now: not a stale or invented id, and never a finished Library video's watched record.
    if (!path || !this.entries().some((e) => e.path === path)) return;
    const id = this.titleFor(path);
    const done = id ? this.#h.appTitles.forget(id.app, id.key) : this.#h.history.forget(path);
    if (done) this.#ctx.toast("Removed from Continue watching");
  }

  /**
   * Menu (or a long press) on Home's Continue watching: a small question with "Remove from Continue watching",
   * and Fix match beside it for a Library film. False when the focus is not on a Continue tile.
   */
  menu(): boolean {
    if (this.#ctx.state.view !== "home" || this.#ctx.state.confirm) return false;
    const id = resolveFocus(this.grid(), this.#ctx.focusOf("home"))?.id;
    // The hero's Resume / From start pills belong to the hero's entry.
    const entry = this.continueRow().find(
      (v) => v.path === id || (v.path === this.#film && (id === "resume" || id === "fromstart")),
    );
    if (!entry) return false;
    const fix = entry.app ? undefined : this.#h.fixTargetFor(entry);
    this.#ctx.ask(
      entry.title,
      ["Remove from Continue watching", ...(fix ? ["Fix match"] : []), "Cancel"],
      [
        () => this.forget(entry.path),
        ...(fix ? [() => this.#h.openFixFromHome(fix)] : []),
        () => {},
      ],
    );
    return true;
  }
}
