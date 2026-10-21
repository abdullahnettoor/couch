import type { Episode, Film, Show } from "./grouping.ts";
import type { MediaLibrary } from "./media-library.ts";
import type { DetailsLookup } from "./art.ts";

export const SEARCH_LIMIT = 20;

/** Lowercase, Latin accents removed, punctuation and separators as single spaces. */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

/** 0 exact, 1 starts with the query, 2 every query word starts some title word; undefined if it doesn't match. */
export function rank(name: string, query: string): 0 | 1 | 2 | undefined {
  const n = normalise(name);
  if (!query || !n) return undefined;
  if (n === query) return 0;
  if (n.startsWith(query)) return 1;
  const words = n.split(" ");
  return query.split(" ").every((q) => words.some((w) => w.startsWith(q))) ? 2 : undefined;
}

export interface Hit<T> {
  item: T;
  /** The name the hit is shown and sorted by. */
  name: string;
}

export interface EpisodeHit extends Hit<Episode> {
  show: Show;
}

export interface SearchResults {
  shows: Hit<Show>[];
  films: Hit<Film>[];
  episodes: EpisodeHit[];
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Keep the best-ranked matches (exact, starts-with, other; then A–Z), at most SEARCH_LIMIT. */
function pick<T>(
  query: string,
  items: T[],
  names: (item: T) => { show: string; names: string[] },
): Hit<T>[] {
  const scored: { item: T; name: string; rank: number }[] = [];
  for (const item of items) {
    const { show, names: candidates } = names(item);
    let best: number | undefined;
    for (const c of candidates) {
      const r = rank(c, query);
      if (r !== undefined && (best === undefined || r < best)) best = r;
    }
    if (best !== undefined) scored.push({ item, name: show, rank: best });
  }
  scored.sort((a, b) => a.rank - b.rank || collator.compare(a.name, b.name));
  return scored.slice(0, SEARCH_LIMIT).map(({ item, name }) => ({ item, name }));
}

const bare = (title: string) => title.replace(/\s*\(\d{4}\)$/, "");

/** A lookup that builds each title's details once. */
export function memoLookup(lookup: DetailsLookup): DetailsLookup {
  const seen = new Map<string, ReturnType<DetailsLookup>>();
  return (id) => {
    if (!seen.has(id)) seen.set(id, lookup(id));
    return seen.get(id);
  };
}

/** Search the Library index (and TMDB names where details exist): shows and films by title, episodes by name. */
export function searchLibrary(
  library: MediaLibrary,
  details: DetailsLookup,
  rawQuery: string,
): SearchResults {
  const lookup = memoLookup(details);
  const query = normalise(rawQuery);
  if (!query) return { shows: [], films: [], episodes: [] };
  const shows = pick(query, library.shows(), (s) => ({
    show: s.name,
    names: [s.name, lookup(s.id)?.name ?? ""],
  }));
  const films = pick(query, library.films(), (f) => ({
    show: bare(f.title),
    names: [f.title, lookup(f.path)?.name ?? ""],
  }));
  const all = library
    .shows()
    .flatMap((show) =>
      show.seasons.flatMap((se) => se.episodes.map((episode) => ({ show, episode }))),
    );
  const episodes = pick(query, all, ({ show, episode }) => {
    const tmdb = lookup(show.id)
      ?.seasons.find((s) => s.number === episode.season)
      ?.episodes.find((e) => e.number === episode.episode)?.name;
    return { show: tmdb ?? episode.title, names: [episode.title, tmdb ?? ""] };
  }).map((h) => ({ item: h.item.episode, name: h.name, show: h.item.show }));
  return { shows, films, episodes };
}
