import type { Episode, Show, WatchState } from "./media-library.ts";

export interface Primary {
  label: string;
  episode: Episode;
  /** "Play again" starts over instead of resuming. */
  fromStart: boolean;
}

export const EXTRAS_TAB = "extras";

const code = (e: Episode) => `S${e.season} E${e.episode}`;

export const allEpisodes = (show: Show): Episode[] => show.seasons.flatMap((s) => s.episodes);

/** What the primary button says and plays: resume, the next unwatched, the first, or play again. */
export function primaryFor(show: Show, history: WatchState): Primary | undefined {
  const all = allEpisodes(show);
  const first = all[0];
  if (!first) return undefined;
  const inProgress = all
    .filter((e) => history.progress(e.path))
    .sort((a, b) => (history.touchedAt(b.path) ?? 0) - (history.touchedAt(a.path) ?? 0))[0];
  if (inProgress) {
    return { label: `Resume ${code(inProgress)}`, episode: inProgress, fromStart: false };
  }
  let furthest = -1;
  all.forEach((e, i) => {
    if (history.isWatched(e.path)) furthest = i;
  });
  if (furthest === -1) return { label: `Play ${code(first)}`, episode: first, fromStart: false };
  const next = all[furthest + 1];
  if (next) return { label: `Play ${code(next)}`, episode: next, fromStart: false };
  return { label: `Play again from ${code(first)}`, episode: first, fromStart: true };
}

/** The tab ids in order: each season, then Extras when there are any. */
export function tabIds(show: Show): string[] {
  return [
    ...show.seasons.map((s) => String(s.number)),
    ...(show.extras.length ? [EXTRAS_TAB] : []),
  ];
}

/** The tab an episode sits in. */
export function tabOf(episode: Episode): string {
  return String(episode.season);
}
