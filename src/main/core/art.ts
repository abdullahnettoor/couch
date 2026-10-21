import type { MediaLibrary } from "./media-library.ts";
import type { TitleDetails } from "./metadata-service.ts";

export type DetailsLookup = (id: string) => TitleDetails | undefined;

export interface PathArt {
  /** The show's (or film's) details; undefined means frames. */
  details?: TitleDetails;
  episode?: { name?: string; overview?: string; still?: string };
}

/** TMDB details for a video path: its show or film, and for an episode its own name, overview and still. */
export function artFor(library: MediaLibrary, lookup: DetailsLookup, path: string): PathArt {
  const show = library.showOf(path);
  if (!show) {
    const details = lookup(path);
    return details ? { details } : {};
  }
  const details = lookup(show.id);
  if (!details) return {};
  const ep = show.seasons.flatMap((s) => s.episodes).find((e) => e.path === path);
  const found = ep
    ? details.seasons
        .find((s) => s.number === ep.season)
        ?.episodes.find((e) => e.number === ep.episode)
    : undefined;
  return {
    details,
    ...(found
      ? {
          episode: {
            ...(found.name ? { name: found.name } : {}),
            ...(found.overview ? { overview: found.overview } : {}),
            ...(found.still ? { still: found.still } : {}),
          },
        }
      : {}),
  };
}
