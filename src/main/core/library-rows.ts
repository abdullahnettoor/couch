import type { LibraryEntry, LibraryRow } from "../../shared/protocol.ts";
import { hueFor, presentation } from "./library.ts";
import type { MediaLibrary, Show, WatchState } from "./media-library.ts";

export interface RowsContext {
  library: MediaLibrary;
  history: WatchState;
  /** Adds progress or the watched tag to a video entry. */
  decorate(entry: LibraryEntry): LibraryEntry;
  /** Continue watching, newest first. */
  continueEntries: LibraryEntry[];
  /** A picture that exists already. */
  thumb(path: string): string | undefined;
}

/** "Elemental (2023)" → "Elemental"; the year has its own place. */
const bare = (title: string, year?: number) => (year ? title.replace(/\s*\(\d{4}\)$/, "") : title);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "S2 · 4 left": episodes left in the season of the first unwatched episode, or "Watched". */
export function showStatus(show: Show, history: WatchState): string {
  for (const season of show.seasons) {
    const left = season.episodes.filter((e) => !history.isWatched(e.path)).length;
    if (left) return `S${season.number} · ${left} left`;
  }
  return "Watched";
}

function showFeature(show: Show): NonNullable<LibraryEntry["feature"]> {
  const sub = [show.year, plural(show.seasons.length, "season")].filter(Boolean).join(" · ");
  return { kind: "Show", title: show.name, sub };
}

/** The action a tile's OK runs. A show's target is the one place 033 swaps for the show page. */
export function tileAction(e: LibraryEntry): string {
  if (e.missing) return "library:missing";
  if (e.kind === "folder") return `library:open:${e.path}`;
  if (e.kind === "show") return `library:show:${e.path}`;
  return `library:play:${e.path}`;
}

/** The Library's rows in order, empty ones left out, and the pictures they want (in priority order). */
export function libraryRows(ctx: RowsContext): { rows: LibraryRow[]; wanted: string[] } {
  const { library, history } = ctx;
  const wanted: string[] = [];
  const picture = (path: string) => {
    wanted.push(path);
    return ctx.thumb(path);
  };

  const showTile = (row: string, show: Show, line: string): LibraryEntry => {
    const first = show.seasons[0]?.episodes[0]?.path;
    const thumb = first ? picture(first) : undefined;
    return {
      kind: "show",
      id: `${row}:${show.id}`,
      path: show.id,
      title: show.name,
      line,
      hue: hueFor(show.name),
      ...(show.missing ? { missing: true } : {}),
      ...(thumb ? { thumb } : {}),
      feature: showFeature(show),
    };
  };
  const filmTile = (
    row: string,
    film: { path: string; title: string; year?: number; missing?: boolean },
    line?: string,
  ) => {
    const thumb = picture(film.path);
    const title = bare(film.title, film.year);
    return ctx.decorate({
      kind: "video",
      id: `${row}:${film.path}`,
      path: film.path,
      title,
      ...(line ? { line } : {}),
      hue: hueFor(title),
      ...(film.missing ? { missing: true } : {}),
      ...(thumb ? { thumb } : {}),
      feature: {
        kind: "Film",
        title: title,
        ...(film.year ? { sub: String(film.year) } : {}),
      },
    });
  };

  const continuing = ctx.continueEntries.map((e): LibraryEntry => {
    const show = library.showOf(e.path);
    const film = library.films().find((f) => f.path === e.path);
    return {
      ...e,
      id: `continue:${e.path}`,
      feature: show
        ? showFeature(show)
        : { kind: "Film", title: e.title, ...(film?.year ? { sub: String(film.year) } : {}) },
    };
  });
  for (const e of continuing) wanted.push(e.path);

  const nextUp = library.nextUp(history).map(({ show, episode }): LibraryEntry => {
    const { title, line } = presentation(episode.path);
    const thumb = picture(episode.path);
    return {
      kind: "video",
      id: `nextup:${episode.path}`,
      path: episode.path,
      title,
      line: line ?? show.name,
      hue: hueFor(show.name),
      ...(episode.missing ? { missing: true } : {}),
      ...(thumb ? { thumb } : {}),
      feature: showFeature(show),
    };
  });

  const shows = library.shows().map((s) => showTile("shows", s, showStatus(s, history)));
  const films = library.films().map((f) => filmTile("films", f));
  const recent = library
    .recentlyAdded(20)
    .map((r) =>
      r.show ? showTile("recent", r.show, "Show") : filmTile("recent", r.film!, "Film"),
    );

  const rows: LibraryRow[] = [
    { id: "continue", title: "Continue watching", entries: continuing },
    { id: "nextup", title: "Next up", entries: nextUp },
    { id: "shows", title: "Shows", poster: true, entries: shows },
    { id: "films", title: "Films", poster: true, entries: films },
    { id: "recent", title: "Recently added", entries: recent },
  ];
  return { rows: rows.filter((r) => r.entries.length), wanted };
}
