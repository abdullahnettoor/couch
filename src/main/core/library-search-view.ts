import type {
  Command,
  GridItem,
  LibraryEntry,
  LibraryRow,
  RemoteId,
  ScreenPayload,
  ScreenState,
  View,
} from "../../shared/protocol.ts";
import type { Source } from "./core.ts";
import { artFor, type DetailsLookup } from "./art.ts";
import { hueFor, presentation } from "./library.ts";
import { memoLookup, searchLibrary, type SearchResults } from "./library-search.ts";
import { showStatus, tileAction } from "./library-rows.ts";
import type { History } from "./history.ts";
import type { Clock } from "../ports/clock.ts";
import type { MediaLibrary } from "./media-library.ts";
import type { ThumbnailScheduler } from "./thumbnail-scheduler.ts";

export const SEARCH_VIEW = "librarySearch";

/** Results follow the typing after this long a pause. */
const DEBOUNCE_MS = 150;

/** What the Library search asks of the core. */
export interface LibrarySearchHost {
  library: MediaLibrary;
  history: History;
  details: DetailsLookup;
  thumbs: ThumbnailScheduler;
  clock: Clock;
  /** The payload changed outside a command (the debounce fired). */
  changed(): void;
  /** Adds progress or the watched tag to a video entry. */
  decorate(entry: LibraryEntry): LibraryEntry;
  /** A phone (or the Screen) starts typing the query: it owns the typing session. */
  startTyping(source: Source): void;
  /** Changes whenever the Library index or any saved details change. */
  dataVersion(): number;
  /** The phone that last sent a command, if it is still connected. */
  connectedPhone(): RemoteId | undefined;
  setView(view: View): void;
  toast(text: string): void;
}

const bare = (title: string) => title.replace(/\s*\(\d{4}\)$/, "");

/**
 * The Library search view: the live query typed on a phone, result rows (Shows, Films, Episodes),
 * their grid and payload. The query lives here, not in the Screen state, and never reaches an App.
 */
export class LibrarySearchView {
  #state: ScreenState;
  #h: LibrarySearchHost;
  /** What the bar shows. */
  #query = "";
  /** What the results are for: the query once typing has paused. */
  #applied = "";
  #cancelDebounce: (() => void) | undefined;
  #wanted = "";
  #found: { query: string; version: number; results: SearchResults } | undefined;

  constructor(state: ScreenState, host: LibrarySearchHost) {
    this.#state = state;
    this.#h = host;
  }

  get query(): string {
    return this.#query;
  }

  /** OK on the Library's search icon, or a phone's Search button. */
  open(): void {
    this.reset();
    this.#h.setView(SEARCH_VIEW);
  }

  #setQuery(query: string): void {
    if (query === this.#query) return;
    this.#query = query;
    this.#cancelDebounce?.();
    this.#cancelDebounce = this.#h.clock.setTimeout(() => {
      this.#cancelDebounce = undefined;
      this.#applied = this.#query;
      this.#h.changed();
    }, DEBOUNCE_MS);
  }

  /** Typing paused or ended: the results are for the query as it stands. */
  #flush(): void {
    this.#cancelDebounce?.();
    this.#cancelDebounce = undefined;
    this.#applied = this.#query;
  }

  /** The search was left (not for a show page): forget the query and where focus was. */
  reset(): void {
    this.#cancelDebounce?.();
    this.#cancelDebounce = undefined;
    this.#applied = "";
    this.#query = "";
    this.#wanted = "";
    delete this.#state.focus[SEARCH_VIEW];
  }

  /** Matching is done once per query and data change; the grid and the payload share it. */
  #results(lookup: DetailsLookup): SearchResults {
    const version = this.#h.dataVersion();
    if (this.#found?.query !== this.#applied || this.#found.version !== version)
      this.#found = {
        query: this.#applied,
        version,
        results: searchLibrary(this.#h.library, lookup, this.#applied),
      };
    return this.#found.results;
  }

  #rows(): LibraryRow[] {
    const { library, history } = this.#h;
    const lookup = memoLookup(this.#h.details);
    const found = this.#results(lookup);
    const wanted: string[] = [];
    const frame = (path: string) => {
      wanted.push(path);
      return this.#h.thumbs.urlFor(path);
    };
    const shows = found.shows.map(({ item: show }): LibraryEntry => {
      const first = show.seasons[0]?.episodes[0]?.path;
      const thumb = lookup(show.id)?.poster ?? (first ? frame(first) : undefined);
      return {
        kind: "show",
        id: `search:shows:${show.id}`,
        path: show.id,
        title: show.name,
        line: showStatus(show, history),
        hue: hueFor(show.name),
        ...(show.missing ? { missing: true } : {}),
        ...(thumb ? { thumb } : {}),
      };
    });
    const films = found.films.map(({ item: film }): LibraryEntry => {
      const title = bare(film.title);
      const thumb = lookup(film.path)?.poster ?? frame(film.path);
      return this.#h.decorate({
        kind: "video",
        id: `search:films:${film.path}`,
        path: film.path,
        title,
        hue: hueFor(title),
        ...(film.missing ? { missing: true } : {}),
        ...(thumb ? { thumb } : {}),
      });
    });
    const episodes = found.episodes.map(({ item: episode, show }): LibraryEntry => {
      const { episode: art } = artFor(library, lookup, episode.path);
      const thumb = art?.still ?? frame(episode.path);
      const line = presentation(episode.path).line;
      return this.#h.decorate({
        kind: "video",
        id: `search:episodes:${episode.path}`,
        path: episode.path,
        title: art?.name ?? episode.title,
        line: `${show.name} · ${line ?? `S${episode.season} E${episode.episode}`}`,
        hue: hueFor(show.name),
        ...(episode.missing ? { missing: true } : {}),
        ...(thumb ? { thumb } : {}),
      });
    });
    const key = wanted.join("\0");
    if (key !== this.#wanted) {
      this.#wanted = key;
      this.#h.thumbs.want(wanted);
    }
    const rows: LibraryRow[] = [
      { id: "shows", title: "Shows", poster: true, entries: shows },
      { id: "films", title: "Films", poster: true, entries: films },
      { id: "episodes", title: "Episodes", entries: episodes },
    ];
    return rows.filter((r) => r.entries.length);
  }

  grid(): GridItem[] {
    const rows = this.#rows();
    return [
      { id: "settings", r: -1, c: 0, label: "Settings", action: "open:settings" },
      { id: "field", r: 0, c: 0, label: "Search", action: "search:field", initial: true },
      ...rows.flatMap((row, r) =>
        row.entries.map((e, c): GridItem => ({
          id: e.id!,
          r: 1 + r,
          c,
          label: e.title,
          action: tileAction(e),
        })),
      ),
    ];
  }

  payload(): Pick<ScreenPayload, "search"> {
    return {
      search: {
        query: this.#query,
        searching: this.#query !== this.#applied && this.#query.trim() !== "",
        typing: this.#state.typingBy !== undefined,
        rows: this.#rows(),
      },
    };
  }

  action(action: string, from: Source): boolean {
    if (action !== "search:field") return false;
    const phone = this.#h.connectedPhone();
    if (from === "screen") this.#h.startTyping(from);
    else if (phone !== undefined) this.#h.startTyping(phone);
    else this.#h.toast("Open Couch's Remote on your phone to search");
    return true;
  }

  /** The typing sheet commands: live text, Search (focus the first result) and Cancel (keep the query). */
  type(command: Command, from: Source): void {
    const owner = this.#state.typingBy;
    switch (command.command) {
      case "typeOpen":
        if (owner !== undefined && owner !== from) return;
        if (this.#state.view !== SEARCH_VIEW) {
          this.open();
          // Only the Screen's own keyboard brings the first character along.
          const first = from === "screen" ? command.args?.text : undefined;
          if (first !== undefined && [...first].length === 1) this.#setQuery(first);
        }
        this.#h.startTyping(from);
        break;
      case "typeText":
        if (owner === from) this.#setQuery(command.args?.text ?? "");
        break;
      case "typeSubmit":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        this.#flush();
        if (this.#rows().length) this.#state.focus[SEARCH_VIEW] = { r: 1, c: 0 };
        break;
      case "typeCancel":
        if (owner !== from) return;
        this.#state.typingBy = undefined;
        this.#flush();
        break;
    }
  }
}
