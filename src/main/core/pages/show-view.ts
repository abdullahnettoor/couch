import type {
  GridItem,
  LibraryEntry,
  ScreenPayload,
  ShowEpisode,
} from "../../../shared/protocol.ts";
import { VIEW_LABELS } from "../../../shared/protocol.ts";
import { moveFocus, resolveFocus } from "../focus.ts";
import type { History } from "../history.ts";
import { hueFor, presentation } from "../library.ts";
import type { MediaLibrary } from "../media-library.ts";
import type { MatchOption, MetadataService } from "../metadata-service.ts";
import { EXTRAS_TAB, allEpisodes, primaryFor, tabIds, tabOf } from "../show-page.ts";
import type { PathArt } from "../art.ts";
import { topGenres } from "../library-rows.ts";
import type { ThumbnailScheduler } from "../thumbnail-scheduler.ts";
import type { Page, PageBack, ShowContext } from "./page.ts";

/** What the show page and Fix match ask of the core. */
export interface ShowViewHost {
  library: MediaLibrary;
  history: History;
  details: MetadataService;
  thumbs: ThumbnailScheduler;
  art(path: string): PathArt;
  /** The current view's grid and its focus key. */
  grid(): GridItem[];
  /** The Library tile under focus, if any. */
  focusedEntry(): LibraryEntry | undefined;
  play(path: string, fromStart?: boolean): void;
  changed(): void;
}

/**
 * The show page (primary button, season tabs, episode list) and Fix match: navigation, focus,
 * grids and payloads. It is two Pages (`page` and `fixPage`) over one state; it changes view only with `go`.
 */
export class ShowView {
  #ctx: ShowContext;
  #h: ShowViewHost;
  /** Where Back from a show page goes: the Library, or the search it was opened from. */
  #from: "library" | "librarySearch" = "library";

  constructor(ctx: ShowContext, host: ShowViewHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  /** The show page. */
  readonly page: Page = {
    grid: () => this.grid(),
    payload: () => this.payload(),
    action: (action) => this.action(action),
    back: () => this.back(),
    move: (direction) => {
      this.move(direction);
      this.syncTab();
    },
  };

  /** Fix match. */
  readonly fixPage: Page = {
    grid: () => this.fixGrid(),
    payload: () => this.fixPayload(),
    action: (action) => this.action(action),
    back: () => ({ label: this.fixBackLabel(), act: () => this.leaveFix() }),
  };

  back(): PageBack {
    return this.#from === "librarySearch"
      ? { label: VIEW_LABELS.librarySearch, act: () => this.#ctx.go("librarySearch") }
      : { label: VIEW_LABELS.library, act: () => this.#ctx.go("library") };
  }

  /** OK on a show tile: the show page, focused on the episode its primary button plays. */
  open(id: string): void {
    const show = this.#h.library.show(id);
    if (!show) return;
    this.#from = this.#ctx.state.view === "librarySearch" ? "librarySearch" : "library";
    this.#ctx.setShow(id);
    const primary = primaryFor(show, this.#h.history);
    if (primary) this.#focusShowEpisode(primary.episode.path);
    else this.#ctx.setShowTab(tabIds(show)[0]);
    this.#ctx.go("show");
    this.#wantShowPictures();
  }

  /** After playback, focus the episode played, or the next one after an end. */
  focusPlayed(path: string, ended: boolean): void {
    const show = this.#h.library.show(this.#ctx.state.showId!);
    if (!show) return;
    const next = ended ? this.#h.library.nextEpisode(path) : undefined;
    this.#focusShowEpisode(next?.path ?? path);
  }

  /** Back on the show page after playback (or the Library when the show is gone). */
  returnTo(): void {
    const show = this.#h.library.show(this.#ctx.state.showId!);
    this.#ctx.go(show ? "show" : "library", { returning: true });
    if (show) this.#wantShowPictures();
  }

  /** Select the episode's season tab and focus its row. */
  #focusShowEpisode(path: string): void {
    const show = this.#ctx.state.showId ? this.#h.library.show(this.#ctx.state.showId) : undefined;
    const episode = show && allEpisodes(show).find((e) => e.path === path);
    if (!show || !episode) return;
    const tab = tabOf(episode);
    this.#ctx.setShowTab(tab);
    const index = show.seasons.find((se) => String(se.number) === tab)!.episodes.indexOf(episode);
    this.#ctx.setFocus(`show:${show.id}`, { r: 1 + index, c: 1 + tabIds(show).indexOf(tab) });
  }

  /** The episodes (or extras) listed under the selected tab. */
  #showList(show: NonNullable<ReturnType<MediaLibrary["show"]>>): ShowEpisode[] {
    const tab = this.#ctx.state.showTab;
    const decorate = (e: ShowEpisode, path: string): ShowEpisode => {
      const { episode } = this.#h.art(path);
      const thumb = episode?.still ?? this.#h.thumbs.urlFor(path);
      const progress = this.#h.history.progress(path);
      const left = progress
        ? Math.max(1, Math.ceil((progress.duration - progress.position) / 60))
        : 0;
      return {
        ...e,
        ...(episode?.name && e.number !== undefined ? { title: episode.name } : {}),
        ...(episode?.overview ? { overview: episode.overview } : {}),
        ...(thumb ? { thumb } : {}),
        ...(progress
          ? {
              progress: {
                fraction: progress.position / progress.duration,
                left: `${left} min left`,
              },
            }
          : this.#h.history.isWatched(path)
            ? { watched: true }
            : {}),
      };
    };
    if (tab === EXTRAS_TAB) {
      return show.extras.map((x) =>
        decorate(
          {
            id: x.path,
            title: x.title,
            hue: hueFor(x.title),
            ...(x.missing ? { missing: true } : {}),
          },
          x.path,
        ),
      );
    }
    const season = show.seasons.find((se) => String(se.number) === tab) ?? show.seasons[0];
    return (season?.episodes ?? []).map((e) =>
      decorate(
        {
          id: e.path,
          number: e.episode,
          title: presentation(e.path).title,
          hue: hueFor(show.name),
          ...(e.missing ? { missing: true } : {}),
        },
        e.path,
      ),
    );
  }

  #wantShowPictures(): void {
    const show = this.#ctx.state.showId ? this.#h.library.show(this.#ctx.state.showId) : undefined;
    if (!show) return;
    const primary = primaryFor(show, this.#h.history)?.episode.path;
    this.#h.thumbs.want([...(primary ? [primary] : []), ...this.#showList(show).map((e) => e.id)]);
  }

  canFix(): boolean {
    const d = this.#h.details.settings();
    return d.enabled && d.keyLabel !== "No key";
  }

  grid(): GridItem[] {
    const show = this.#ctx.state.showId ? this.#h.library.show(this.#ctx.state.showId) : undefined;
    if (!show) return [];
    const tabs = tabIds(show);
    const selected = Math.max(0, tabs.indexOf(this.#ctx.state.showTab ?? ""));
    const primary = primaryFor(show, this.#h.history);
    const grid: GridItem[] = [
      { id: "settings", r: -1, c: 0, label: "Settings", action: "open:settings" },
      { id: "play", r: 0, c: 0, label: primary?.label ?? "Play", action: "show:play" },
      ...tabs.map((t, i) => ({
        id: `tab:${t}`,
        r: 0,
        c: 1 + i,
        label: t === EXTRAS_TAB ? "Extras" : `Season ${t}`,
        action: `show:tab:${t}`,
      })),
      ...this.#showList(show).map((e, i) => ({
        id: e.id,
        r: 1 + i,
        c: 1 + selected,
        label: e.title,
        action: `library:play:${e.id}`,
      })),
    ];
    if (this.canFix()) grid.push({ id: "fix", r: 1, c: 0, label: "Fix match", action: "show:fix" });
    const first = grid.find((i) => i.id === primary?.episode.path) ?? grid[0];
    if (first) first.initial = true;
    return grid;
  }

  #fixOptions: MatchOption[] | undefined;

  fixGrid(): GridItem[] {
    const options = this.#fixOptions ?? [];
    return [
      ...options.map((o, i) => ({
        id: `cand:${o.tmdbId}`,
        r: i,
        c: 0,
        label: o.name,
        action: `fix:${o.tmdbId}`,
        initial: i === 0,
      })),
      {
        id: "frames",
        r: options.length,
        c: 0,
        label: "Use video frames",
        action: "fix:frames",
        initial: options.length === 0,
      },
    ];
  }

  action(action: string): boolean {
    const [ns, verb, ...rest] = action.split(":");
    const arg = rest.join(":");
    if (ns === "fix") {
      this.#applyFix(verb === "frames" ? "frames" : Number(verb));
      return true;
    }
    if (ns !== "show") return false;
    const show = this.#ctx.state.showId ? this.#h.library.show(this.#ctx.state.showId) : undefined;
    if (!show) return true;
    if (verb === "play") {
      const primary = primaryFor(show, this.#h.history);
      if (primary) this.#h.play(primary.episode.path, primary.fromStart);
    } else if (verb === "tab") {
      this.#ctx.setShowTab(arg);
      this.#wantShowPictures();
      const list = this.#showList(show);
      const c = 1 + tabIds(show).indexOf(arg);
      if (list.length) this.#ctx.setFocus(this.#ctx.viewKey(), { r: 1, c });
    } else if (verb === "fix") {
      this.#openFixMatch(show.id);
    }
    return true;
  }

  /** Where Fix match was opened from, and for which show or film. */
  #fixId: string | undefined;
  #fixBack: "show" | "library" | "home" = "show";

  /** The show or film under the focused Library tile, when its match can be fixed. */
  fixTarget(): string | undefined {
    if (this.#ctx.state.view !== "library") return undefined;
    return this.fixTargetFor(this.#h.focusedEntry());
  }

  /** The id Fix match would fix for this entry (a show, or a film), if it applies. */
  fixTargetFor(entry: LibraryEntry | undefined): string | undefined {
    if (!this.canFix()) return undefined;
    if (!entry || entry.missing) return undefined;
    if (entry.kind === "show") return entry.path;
    if (entry.kind !== "video" || this.#h.library.showOf(entry.path)) return undefined;
    return this.#h.library.films().some((f) => f.path === entry.path) ? entry.path : undefined;
  }

  /** Menu key, long press or the phone's button: Fix match for the focused show or film. */
  menu(): void {
    if (this.#ctx.state.view === "show" && this.#ctx.state.showId && this.canFix())
      return this.#openFixMatch(this.#ctx.state.showId, "show");
    const id = this.fixTarget();
    if (id) this.#openFixMatch(id, "library");
  }

  /** Back from Fix match to where it was opened. */
  leaveFix(): void {
    this.#leaveFixTo(this.#fixBack);
  }

  /** Going Home is the Home button's trip (it forgets Home's focus); coming back from Fix match keeps it, with its hero. */
  #leaveFixTo(view: "show" | "library" | "home"): void {
    this.#ctx.go(view, { returning: true });
  }

  /** Fix match for a film on Home's Continue watching; Back returns to Home. */
  openFixFromHome(id: string): void {
    this.#openFixMatch(id, "home");
  }

  #openFixMatch(id: string, back: "show" | "library" | "home" = "show"): void {
    this.#fixId = id;
    this.#fixBack = back;
    this.#fixOptions = undefined;
    this.#ctx.setFocus("fixMatch");
    this.#ctx.go("fixMatch");
    void this.#h.details.candidates(id).then((options) => {
      if (this.#ctx.state.view !== "fixMatch" || this.#fixId !== id) return;
      this.#fixOptions = options;
      this.#h.changed();
    });
  }

  #applyFix(choice: number | "frames"): void {
    const id = this.#fixId;
    if (!id) return;
    this.#leaveFixTo(this.#fixBack);
    this.#ctx.toast(choice === "frames" ? "Using video frames" : "Fixing the match");
    void this.#h.details.fixMatch(id, choice).then(() => this.#h.changed());
  }

  /** After a move or hover onto a season tab, the list below follows. */
  syncTab(): void {
    if (this.#ctx.state.view !== "show") return;
    const focused = resolveFocus(this.#h.grid(), this.#ctx.focusOf(this.#ctx.viewKey()));
    if (focused?.id.startsWith("tab:")) {
      const tab = focused.id.slice(4);
      if (tab !== this.#ctx.state.showTab) {
        this.#ctx.setShowTab(tab);
        this.#wantShowPictures();
      }
    }
  }

  move(direction: "up" | "down" | "left" | "right"): void {
    const grid = this.#h.grid();
    const current = resolveFocus(grid, this.#ctx.focusOf(this.#ctx.viewKey()));
    if (!current) return;
    const set = (i: GridItem) => this.#ctx.setFocus(this.#ctx.viewKey(), { r: i.r, c: i.c });
    const buttons = grid.filter((i) => i.c === 0);
    if (current.c === 0) {
      if (direction === "right") {
        const primary = grid.find((i) => i.initial && i.c > 0);
        const target =
          primary ?? grid.find((i) => i.c > 0 && i.r >= 1) ?? grid.find((i) => i.c > 0);
        if (target) set(target);
      } else if (direction !== "left") {
        set(moveFocus(buttons, current, direction));
      }
      return;
    }
    const next = moveFocus(grid, current, direction);
    if (direction === "left" && (next === current || current.r >= 1)) {
      set(grid.find((i) => i.id === "play")!);
    } else set(next);
  }

  payload(): Pick<ScreenPayload, "show"> {
    const show = this.#ctx.state.showId ? this.#h.library.show(this.#ctx.state.showId) : undefined;
    if (!show) return {};
    const primary = primaryFor(show, this.#h.history);
    const tabs = tabIds(show);
    const selected = tabs.includes(this.#ctx.state.showTab ?? "")
      ? this.#ctx.state.showTab
      : tabs[0];
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const d = this.#h.details.detailsFor(show.id);
    const backdrop = d?.backdrop ?? (primary && this.#h.thumbs.urlFor(primary.episode.path));
    return {
      show: {
        id: show.id,
        name: show.name,
        meta: [
          ...((d?.years ?? show.year) ? [d?.years ?? String(show.year)] : []),
          plural(show.seasons.length, "season"),
          plural(show.episodeCount, "episode"),
        ],
        primary: primary?.label ?? "Play",
        ...(backdrop ? { backdrop } : {}),
        ...(d?.poster ? { poster: d.poster } : {}),
        ...(d?.overview ? { overview: d.overview } : {}),
        ...(d?.genres?.length ? { genres: topGenres(d) } : {}),
        tabs: tabs.map((t) => ({
          id: t,
          label: t === EXTRAS_TAB ? "Extras" : `Season ${t}`,
          selected: t === selected,
        })),
        episodes: this.#showList(show),
        canFix: this.canFix(),
        artExpected: this.canFix() && !this.#h.details.usesFrames(show.id),
      },
    };
  }

  #fixName(): string {
    const id = this.#fixId ?? "";
    const name =
      this.#h.library.show(id)?.name ??
      this.#h.library.films().find((f) => f.path === id)?.title ??
      "";
    return name.replace(/\s*\(\d{4}\)$/, "");
  }

  /** What Back from Fix match names: the Library, or the show it was opened from. */
  fixBackLabel(): string {
    return this.#fixBack === "library"
      ? "Library"
      : this.#fixBack === "home"
        ? VIEW_LABELS.home
        : this.#fixName();
  }

  fixPayload(): Pick<ScreenPayload, "fixMatch"> {
    return {
      fixMatch: {
        name: this.#fixName(),
        loading: this.#fixOptions === undefined,
        options: (this.#fixOptions ?? []).map((o) => ({
          id: `cand:${o.tmdbId}`,
          name: o.name,
          ...(o.year ? { year: o.year } : {}),
          ...(o.poster ? { poster: o.poster } : {}),
        })),
      },
    };
  }
}
