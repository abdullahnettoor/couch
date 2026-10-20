import { basename, dirname, sep } from "node:path";
import { cleanFolderName, type Title } from "./library.ts";

/** One video file in the index. `folders` is the folder chain below the Library folder `root`. */
export interface IndexedVideo {
  path: string;
  size: number;
  mtime: number;
  root: string;
  folders: string[];
  title: Title;
  /** Epoch ms the index first saw the file (its modified time on the very first scan). */
  firstSeen: number;
  /** Its Library folder's drive isn't connected. */
  missing?: boolean;
}

export interface Episode {
  path: string;
  season: number;
  episode: number;
  title: string;
  addedAt: number;
  missing?: boolean;
}

export interface Extra {
  path: string;
  title: string;
  addedAt: number;
  missing?: boolean;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface Show {
  id: string;
  name: string;
  year?: number;
  seasons: Season[];
  episodeCount: number;
  extras: Extra[];
  /** Newest first-seen date among its videos. */
  addedAt: number;
  /** Every episode is on a drive that isn't connected. */
  missing?: boolean;
}

export interface Film {
  id: string;
  path: string;
  title: string;
  year?: number;
  addedAt: number;
  missing?: boolean;
}

export interface Grouped {
  shows: Show[];
  films: Film[];
}

const EXTRAS_DIR = /(?:^|[\s-])(?:extras?|featurettes?|specials?|bonus|behind the scenes)$/i;
const SEASON_DIR = /^(?:(.*?)[\s._-]*)?(?:s|season|series)[\s._-]*\d{1,2}$/i;
const YEAR_TAIL = /\s*\(?\b((?:19|20)\d{2})(?:-\d{2,4})?\)?$/;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Case- and punctuation-insensitive show identity, ignoring a trailing year. */
export function showKey(name: string): string {
  return name
    .replace(YEAR_TAIL, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function splitYear(name: string): { name: string; year?: number } {
  const m = YEAR_TAIL.exec(name);
  if (!m || m.index === 0) return { name };
  return { name: name.slice(0, m.index), year: Number(m[1]) };
}

const initials = (tokens: string[]) => tokens.map((t) => t[0] ?? "").join("");

/** Keys that are the same name with an acronym ("avatar tla" / "avatar the last airbender") map to the longer one. */
function mergeKeys(keys: string[]): Map<string, string> {
  const expands = (a: string[], b: string[]) => {
    for (let i = 0; i < b.length; i++)
      for (let n = 2; i + n <= b.length; n++) {
        const folded = [...b.slice(0, i), initials(b.slice(i, i + n)), ...b.slice(i + n)];
        if (folded.length === a.length && folded.every((t, j) => t === a[j])) return true;
      }
    return false;
  };
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => (parent.get(k) === k ? k : find(parent.get(k)!));
  for (const a of keys)
    for (const b of keys)
      if (a !== b && expands(a.split(" "), b.split(" "))) {
        const [ra, rb] = [find(a), find(b)];
        parent.set(ra.length > rb.length ? rb : ra, ra.length > rb.length ? ra : rb);
      }
  return new Map(keys.map((k) => [k, find(k)]));
}

const firstToken = (key: string) => key.split(" ")[0] ?? "";

/** Folder chain as absolute directories, shallowest first (the Library folder itself excluded). */
function dirsOf(v: IndexedVideo): string[] {
  const out: string[] = [];
  let dir = v.root;
  for (const f of v.folders) {
    dir = `${dir}${sep}${f}`;
    out.push(dir);
  }
  return out;
}

interface Anchor {
  name: string;
  dir: string | undefined;
}

/** The series name for an episode without one in its file name: the nearest folder that isn't just a season. */
function anchorOf(v: IndexedVideo): Anchor {
  const dirs = dirsOf(v);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const cleaned = cleanFolderName(basename(dirs[i]!));
    const m = SEASON_DIR.exec(cleaned);
    if (!m) return { name: cleaned, dir: dirs[i] };
    if (m[1]?.trim()) return { name: m[1].trim(), dir: dirs[i] };
  }
  return { name: cleanFolderName(basename(v.root)) || v.root, dir: undefined };
}

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);

interface Building {
  key: string;
  name: string;
  year?: number;
  dirs: Set<string>;
  episodes: Episode[];
  extras: Extra[];
}

const addedAt = (v: IndexedVideo) => v.firstSeen;

/** Numbers like "01 …" or "Part 2": the first standalone number in the cleaned name. */
function numberOf(title: string): number | undefined {
  const tok = title.split(/\s+/).find((t) => /^\d{1,3}$/.test(t));
  return tok === undefined ? undefined : Number(tok);
}

/** Group indexed videos into Shows (episodes + Extras) and Films, by the spec's seven rules. */
export function groupVideos(videos: IndexedVideo[]): Grouped {
  const building = new Map<string, Building>();
  const build = (key: string, name: string): Building => {
    let b = building.get(key);
    if (!b) building.set(key, (b = { key, name, dirs: new Set(), episodes: [], extras: [] }));
    return b;
  };

  // Rule 1: episodes. Series name from the file, else the nearest non-season folder.
  const found: { v: IndexedVideo; raw: string; name: string; anchor: Anchor }[] = [];
  for (const v of videos) {
    if (v.title.episode === undefined) continue;
    const anchor = anchorOf(v);
    const name = v.title.series || anchor.name;
    const raw = showKey(name);
    if (raw) found.push({ v, raw, name, anchor });
  }
  // Rule 2: "Avatar TLA" and "Avatar The Last Airbender" are one show.
  const merged = mergeKeys([...new Set(found.map((f) => f.raw))]);
  const dirShows = new Map<string, Set<string>>();
  const aliases = new Map<string, Set<string>>();
  for (const f of found) {
    const key = merged.get(f.raw)!;
    (aliases.get(key) ?? aliases.set(key, new Set()).get(key)!).add(f.raw);
    for (const d of dirsOf(f.v)) (dirShows.get(d) ?? dirShows.set(d, new Set()).get(d)!).add(key);
  }
  const folderNames = new Map<string, { name: string; year?: number }[]>();
  for (const { v, raw, name, anchor } of found) {
    const key = merged.get(raw)!;
    const split = splitYear(name);
    const b = build(key, split.name);
    if (split.year && !b.year) b.year = split.year;
    if (anchor.dir) b.dirs.add(anchor.dir);
    b.episodes.push({
      path: v.path,
      season: v.title.season ?? 1,
      episode: v.title.episode!,
      title: v.title.name,
      addedAt: addedAt(v),
      ...(v.missing ? { missing: true } : {}),
    });
    // The display name prefers the show's own folders (ones holding only this show) over the files' shortened name.
    for (const d of dirsOf(v)) {
      if (dirShows.get(d)?.size !== 1) continue;
      const cleaned = cleanFolderName(basename(d));
      const m = SEASON_DIR.exec(cleaned);
      const folderName = m ? (m[1] ?? "").trim() : cleaned;
      if (!folderName) continue;
      const fk = showKey(folderName);
      const related = [...aliases.get(key)!].some(
        (a) => firstToken(a) === firstToken(fk) || a.split(" ").includes(initials(fk.split(" "))),
      );
      if (!related) continue;
      b.dirs.add(d);
      (folderNames.get(key) ?? folderNames.set(key, []).get(key)!).push(splitYear(folderName));
    }
  }
  // The longest folder name is the most descriptive: "Avatar The Last Airbender" over "The Last Airbender".
  for (const [key, names] of folderNames) {
    const best = names.reduce((x, y) => (y.name.length > x.name.length ? y : x));
    const b = building.get(key)!;
    b.name = best.name;
    if (best.year) b.year = best.year;
  }

  const rest: IndexedVideo[] = [];
  const showList = [...building.values()];
  const extraOf = (v: IndexedVideo): Building | undefined => {
    const own = dirname(v.path);
    let best: Building | undefined;
    let bestLen = -1;
    for (const b of showList)
      for (const d of b.dirs) {
        if (!isUnder(own, d)) continue;
        if (d.length > bestLen) ((best = b), (bestLen = d.length));
      }
    return best;
  };

  for (const v of videos) {
    if (v.title.episode !== undefined) continue;
    // Rule 3: inside a show's folder tree, or in an Extras-named folder.
    const home = extraOf(v);
    if (home) {
      home.extras.push({
        path: v.path,
        title: v.title.name,
        addedAt: addedAt(v),
        ...(v.missing ? { missing: true } : {}),
      });
      continue;
    }
    const dirs = dirsOf(v);
    const at = dirs.findLastIndex((d) => EXTRAS_DIR.test(cleanFolderName(basename(d))));
    if (at === -1) {
      rest.push(v);
      continue;
    }
    const parent = at === 0 ? v.root : dirs[at - 1]!;
    const near = showList.filter((b) => [...b.dirs].some((d) => isUnder(d, parent)));
    const pick =
      near.length === 1
        ? near[0]
        : (() => {
            const k = showKey(cleanFolderName(basename(parent)));
            const same = near.filter((b) => b.key === k);
            return same.length === 1 ? same[0] : undefined;
          })();
    if (pick) {
      pick.extras.push({
        path: v.path,
        title: v.title.name,
        addedAt: addedAt(v),
        ...(v.missing ? { missing: true } : {}),
      });
    }
  }

  // Rule 4: a folder of three or more videos numbered in order, without years, is a show.
  const byDir = new Map<string, IndexedVideo[]>();
  for (const v of rest)
    (byDir.get(dirname(v.path)) ?? byDir.set(dirname(v.path), []).get(dirname(v.path))!).push(v);
  const films: IndexedVideo[] = [];
  for (const [dir, vs] of byDir) {
    const nums = vs.map((v) => numberOf(v.title.name));
    const numbered =
      vs.length >= 3 &&
      nums.every((n) => n !== undefined) &&
      new Set(nums).size === vs.length &&
      !vs.some((v) => /\b(?:19|20)\d{2}\b/.test(basename(v.path)));
    if (!numbered || dir === vs[0]!.root) {
      films.push(...vs);
      continue;
    }
    const name = cleanFolderName(basename(dir));
    const split = splitYear(name);
    const b = build(showKey(name), split.name);
    if (split.year) b.year = split.year;
    vs.forEach((v, i) =>
      b.episodes.push({
        path: v.path,
        season: 1,
        episode: nums[i]!,
        title: v.title.name,
        addedAt: addedAt(v),
        ...(v.missing ? { missing: true } : {}),
      }),
    );
  }

  const shows = [...building.values()].map((b): Show => {
    const sorted = [...b.episodes].sort(
      (a, c) => a.season - c.season || a.episode - c.episode || collator.compare(a.path, c.path),
    );
    const seasons: Season[] = [];
    for (const e of sorted) {
      let s = seasons.at(-1);
      if (s?.number !== e.season) seasons.push((s = { number: e.season, episodes: [] }));
      s.episodes.push(e);
    }
    const extras = [...b.extras].sort((a, c) => collator.compare(a.path, c.path));
    const year = b.year;
    return {
      id: `show:${b.key.replace(/ /g, "-")}`,
      name: b.name,
      ...(year ? { year } : {}),
      seasons,
      episodeCount: sorted.length,
      extras,
      addedAt: Math.max(...[...sorted, ...extras].map((e) => e.addedAt)),
      ...(sorted.every((e) => e.missing) ? { missing: true } : {}),
    };
  });
  shows.sort((a, b) => collator.compare(a.name, b.name));

  const filmList = films
    .map((v): Film => {
      const t = v.title.name;
      const y = /\((\d{4})\)$/.exec(t);
      return {
        id: v.path,
        path: v.path,
        title: t,
        ...(y ? { year: Number(y[1]) } : {}),
        addedAt: addedAt(v),
        ...(v.missing ? { missing: true } : {}),
      };
    })
    .sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.path, b.path));
  return { shows, films: filmList };
}
