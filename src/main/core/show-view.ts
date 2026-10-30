import type {
  GridItem,
  LibraryEntry,
  ScreenPayload,
  ScreenState,
  ShowEpisode,
  View,
} from "../../shared/protocol.ts";
import { VIEW_LABELS } from "../../shared/protocol.ts";
import { moveFocus, resolveFocus } from "./focus.ts";
import type { History } from "./history.ts";
import { hueFor, presentation } from "./library.ts";
import type { MediaLibrary } from "./media-library.ts";
import type { MatchOption, MetadataService } from "./metadata-service.ts";
import { EXTRAS_TAB, allEpisodes, primaryFor, tabIds, tabOf } from "./show-page.ts";
import type { PathArt } from "./art.ts";
import { topGenres } from "./library-rows.ts";
import type { ThumbnailScheduler } from "./thumbnail-scheduler.ts";

/** What the show page and Fix match ask of the core. */
export interface ShowViewHost {
  library: MediaLibrary;
  history: History;
  details: MetadataService;
  thumbs: ThumbnailScheduler;
  art(path: string): PathArt;
  /** The current view's grid and its focus key. */
  grid(): GridItem[];
  viewKey(): string;
  /** The Library tile under focus, if any. */
  focusedEntry(): LibraryEntry | undefined;
  play(path: string, fromStart?: boolean): void;
  setView(view: View): void;
  toast(text: string): void;
  changed(): void;
}

/**
 * The show page (primary button, season tabs, episode list) and Fix match: navigation, focus,
 * grids and payloads. Reads and writes `showId`, `showTab`, `focus` and `view` on the shared Screen state.
 */
export class ShowView {
  #state: ScreenState;
  #h: ShowViewHost;

  constructor(state: ScreenState, host: ShowViewHost) {
    this.#state = state;
    this.#h = host;
  }

  /** OK on a show tile: the show page, focused on the episode its primary button plays. */
  open(id: string): void {
    const show = this.#h.library.show(id);
    if (!show) return;
    this.#state.showId = id;
    const primary = primaryFor(show, this.#h.history);
    if (primary) this.#focusShowEpisode(primary.episode.path);
    else this.#state.showTab = tabIds(show)[0];
    this.#h.setView("show");
    this.#wantShowPictures();
  }

  /** Back on the show page after playback: focus the episode played, or the next one after an end. */
  returnTo(path: string, ended: boolean): void {
    const show = this.#h.library.show(this.#state.showId!);
    if (!show) {
      this.#state.view = "library";
      return;
    }
    const next = ended ? this.#h.library.nextEpisode(path) : undefined;
    this.#focusShowEpisode(next?.path ?? path);
    this.#state.view = "show";
    this.#wantShowPictures();
  }

  /** Select the episode's season tab and focus its row. */
  #focusShowEpisode(path: string): void {
    const show = this.#state.showId ? this.#h.library.show(this.#state.showId) : undefined;
    const episode = show && allEpisodes(show).find((e) => e.path === path);
    if (!show || !episode) return;
    const tab = tabOf(episode);
    this.#state.showTab = tab;
    const index = show.seasons.find((se) => String(se.number) === tab)!.episodes.indexOf(episode);
    this.#state.focus[`show:${show.id}`] = { r: 1 + index, c: 1 + tabIds(show).indexOf(tab) };
  }

  /** The episodes (or extras) listed under the selected tab. */
  #showList(show: NonNullable<ReturnType<MediaLibrary["show"]>>): ShowEpisode[] {
    const tab = this.#state.showTab;
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
    const show = this.#state.showId ? this.#h.library.show(this.#state.showId) : undefined;
    if (!show) return;
    const primary = primaryFor(show, this.#h.history)?.episode.path;
    this.#h.thumbs.want([...(primary ? [primary] : []), ...this.#showList(show).map((e) => e.id)]);
  }

  canFix(): boolean {
    const d = this.#h.details.settings();
    return d.enabled && d.keyLabel !== "No key";
  }

  grid(): GridItem[] {
    const show = this.#state.showId ? this.#h.library.show(this.#state.showId) : undefined;
    if (!show) return [];
    const tabs = tabIds(show);
    const selected = Math.max(0, tabs.indexOf(this.#state.showTab ?? ""));
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
    const show = this.#state.showId ? this.#h.library.show(this.#state.showId) : undefined;
    if (!show) return true;
    if (verb === "play") {
      const primary = primaryFor(show, this.#h.history);
      if (primary) this.#h.play(primary.episode.path, primary.fromStart);
    } else if (verb === "tab") {
      this.#state.showTab = arg;
      this.#wantShowPictures();
      const list = this.#showList(show);
      const c = 1 + tabIds(show).indexOf(arg);
      if (list.length) this.#state.focus[this.#h.viewKey()] = { r: 1, c };
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
    if (this.#state.view !== "library") return undefined;
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
    if (this.#state.view === "show" && this.#state.showId && this.canFix())
      return this.#openFixMatch(this.#state.showId, "show");
    const id = this.fixTarget();
    if (id) this.#openFixMatch(id, "library");
  }

  /** Back from Fix match to where it was opened. */
  leaveFix(): void {
    this.#state.view = this.#fixBack;
  }

  /** Fix match for a film on Home's Continue watching; Back returns to Home. */
  openFixFromHome(id: string): void {
    this.#openFixMatch(id, "home");
  }

  #openFixMatch(id: string, back: "show" | "library" | "home" = "show"): void {
    this.#fixId = id;
    this.#fixBack = back;
    this.#fixOptions = undefined;
    delete this.#state.focus.fixMatch;
    this.#state.view = "fixMatch";
    void this.#h.details.candidates(id).then((options) => {
      if (this.#state.view !== "fixMatch" || this.#fixId !== id) return;
      this.#fixOptions = options;
      this.#h.changed();
    });
  }

  #applyFix(choice: number | "frames"): void {
    const id = this.#fixId;
    if (!id) return;
    this.#state.view = this.#fixBack;
    this.#h.toast(choice === "frames" ? "Using video frames" : "Fixing the match");
    void this.#h.details.fixMatch(id, choice).then(() => this.#h.changed());
  }

  /** After a move or hover onto a season tab, the list below follows. */
  syncTab(): void {
    if (this.#state.view !== "show") return;
    const focused = resolveFocus(this.#h.grid(), this.#state.focus[this.#h.viewKey()]);
    if (focused?.id.startsWith("tab:")) {
      const tab = focused.id.slice(4);
      if (tab !== this.#state.showTab) {
        this.#state.showTab = tab;
        this.#wantShowPictures();
      }
    }
  }

  move(direction: "up" | "down" | "left" | "right"): void {
    const grid = this.#h.grid();
    const current = resolveFocus(grid, this.#state.focus[this.#h.viewKey()]);
    if (!current) return;
    const set = (i: GridItem) => (this.#state.focus[this.#h.viewKey()] = { r: i.r, c: i.c });
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
    const show = this.#state.showId ? this.#h.library.show(this.#state.showId) : undefined;
    if (!show) return {};
    const primary = primaryFor(show, this.#h.history);
    const tabs = tabIds(show);
    const selected = tabs.includes(this.#state.showTab ?? "") ? this.#state.showTab : tabs[0];
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
