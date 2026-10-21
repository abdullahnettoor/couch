import type { LibraryChip } from "../../shared/protocol.ts";
import type { MetadataService } from "./metadata-service.ts";

export const CHIP_MIN_TITLES = 3;
export const CHIP_MAX_GENRES = 8;
export const AUTO_MIN_TITLES = 5;
export const AUTO_MAX_TITLES = 20;
export const AUTO_LANGUAGE_ROWS = 2;

type Facets = Pick<MetadataService, "languages" | "genres" | "filter">;

/** Which titles a chip keeps: by kind alone, or from the ids TMDB details gave. */
export type TitleKeep = (titleId: string, kind: "show" | "film") => boolean;

export interface ChipsContext {
  details: Facets;
  shows: number;
  films: number;
  /** The active chip's key, if any. */
  active?: string;
}

/** All, Shows, Films, then languages and genres with enough titles, most first; just All when there is nothing to pick. */
export function chipsFor(ctx: ChipsContext): LibraryChip[] {
  const chip = (key: string, label: string): LibraryChip => ({
    key,
    label,
    active: ctx.active === key,
  });
  const chips = [
    ...(ctx.shows ? [chip("shows", "Shows")] : []),
    ...(ctx.films ? [chip("films", "Films")] : []),
    ...ctx.details
      .languages()
      .filter((l) => l.count >= CHIP_MIN_TITLES)
      .map((l) => chip(`lang:${l.key}`, l.name)),
    ...ctx.details
      .genres()
      .filter((g) => g.count >= CHIP_MIN_TITLES)
      .slice(0, CHIP_MAX_GENRES)
      .map((g) => chip(`genre:${g.key}`, g.name)),
  ];
  return chips.length ? [{ key: "all", label: "All", active: !ctx.active }, ...chips] : [];
}

/** The filter an active chip applies to every row. */
export function keepFor(key: string, details: Facets): TitleKeep {
  if (key === "shows") return (_, kind) => kind === "show";
  if (key === "films") return (_, kind) => kind === "film";
  const [type, ...rest] = key.split(":");
  const value = rest.join(":");
  const ids = new Set(details.filter(type === "lang" ? { language: value } : { genre: value }));
  return (id) => ids.has(id);
}

export interface AutoRow {
  id: string;
  title: string;
  ids: Set<string>;
  /** Films only ("<Language> films"), else shows and films. */
  films: boolean;
}

/** "<Language> films" for the top languages after the most common one, and "<Genre>" for the top genre. */
export function autoRows(details: Facets): AutoRow[] {
  const rows: AutoRow[] = [];
  for (const l of details.languages().slice(1, 1 + AUTO_LANGUAGE_ROWS)) {
    const ids = new Set(details.filter({ kind: "film", language: l.key }));
    if (ids.size >= AUTO_MIN_TITLES)
      rows.push({ id: `auto:lang:${l.key}`, title: `${l.name} films`, ids, films: true });
  }
  const top = details.genres()[0];
  if (top) {
    const ids = new Set(details.filter({ genre: top.key }));
    if (ids.size >= AUTO_MIN_TITLES)
      rows.push({ id: `auto:genre:${top.key}`, title: top.name, ids, films: false });
  }
  return rows;
}
