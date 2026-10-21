import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { basename, extname, join } from "node:path";
import type { LibraryEntry } from "../../shared/protocol.ts";

export const VIDEO_EXTENSIONS = [".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm"];

const TAGS = new Set([
  "480p",
  "576p",
  "720p",
  "1080p",
  "1080i",
  "2160p",
  "4k",
  "uhd",
  "bluray",
  "blu-ray",
  "bdrip",
  "brrip",
  "webrip",
  "web-dl",
  "webdl",
  "web",
  "dvdrip",
  "dvdscr",
  "hdtv",
  "hdrip",
  "hdcam",
  "x264",
  "x265",
  "h264",
  "h265",
  "hevc",
  "avc",
  "xvid",
  "divx",
  "aac",
  "ac3",
  "dts",
  "ddp5",
  "remux",
  "proper",
  "repack",
  "unrated",
  "hdr",
  "hdr10",
  "10bit",
  "yify",
  "yts",
  "rarbg",
]);

const YEAR = /^(19|20)\d{2}$/;

function words(text: string): string[] {
  return text
    .replace(/[._()[\]{}]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function untagged(list: string[], from = 1): string[] {
  const cut = list.findIndex((w, i) => i >= from && TAGS.has(w.toLowerCase()));
  return cut === -1 ? list : list.slice(0, cut);
}

/** "Kung-Fu-Panda-4" → separate words; "Gru-2022" and "Movie-1080p" split at the year or tag. Real hyphens in titles stay. */
function dehyphen(list: string[]): string[] {
  const single = list.filter((w) => !TAGS.has(w.toLowerCase()) && !YEAR.test(w)).length === 1;
  return list.flatMap((w) => {
    if (!w.includes("-") || TAGS.has(w.toLowerCase())) return [w];
    const parts = w.split("-").filter(Boolean);
    const joined = parts.some((p, i) => i > 0 && (YEAR.test(p) || TAGS.has(p.toLowerCase())));
    if (!joined && !(single && parts.length >= 3)) return [w];
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const pair = `${parts[i]}-${parts[i + 1]}`;
      if (i + 1 < parts.length && TAGS.has(pair.toLowerCase())) (out.push(pair), i++);
      else out.push(parts[i]!);
    }
    return out;
  });
}

const EDITIONS: { re: RegExp; label: string }[] = [
  { re: /^extended(?: (?:edition|cut|version))?$/i, label: "Extended" },
  { re: /^theatrical(?: (?:edition|cut|version))?$/i, label: "Theatrical" },
  { re: /^director'?s cut$/i, label: "Director's Cut" },
  { re: /^unrated$/i, label: "Unrated" },
  { re: /^uncut$/i, label: "Uncut" },
  { re: /^remastered$/i, label: "Remastered" },
  { re: /^special edition$/i, label: "Special Edition" },
  { re: /^ultimate edition$/i, label: "Ultimate Edition" },
  { re: /^final cut$/i, label: "Final Cut" },
  { re: /^imax$/i, label: "IMAX" },
  { re: /^criterion(?: (?:collection|edition))?$/i, label: "Criterion" },
  { re: /^(?:\d+(?:st|nd|rd|th) )?anniversary edition$/i, label: "Anniversary Edition" },
];

/** The edition phrase starting at `i`: how many words it takes and its label. Longest phrase wins. */
function editionAt(list: string[], i: number): { length: number; label: string } | undefined {
  for (let n = 3; n >= 1; n--) {
    if (i + n > list.length) continue;
    const phrase = list.slice(i, i + n).join(" ");
    const hit = EDITIONS.find((e) => e.re.test(phrase));
    if (hit) return { length: n, label: hit.label };
  }
  return undefined;
}

/**
 * Edition tags out of the words, kept as a label. A tag must not open the title and must end the title
 * part: be followed by the end, a year, a release tag or another edition ("Extended Family" stays).
 */
function withoutEditions(list: string[]): { list: string[]; edition?: string } {
  const labels: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < list.length;) {
    const hit = i > 0 ? editionAt(list, i) : undefined;
    const next = hit ? list[i + hit.length] : undefined;
    const ends =
      next === undefined ||
      YEAR.test(next) ||
      TAGS.has(next.toLowerCase()) ||
      editionAt(list, i + hit!.length) !== undefined;
    if (hit && ends) {
      if (!labels.includes(hit.label)) labels.push(hit.label);
      i += hit.length;
    } else out.push(list[i++]!);
  }
  return { list: out, ...(labels.length ? { edition: labels.join(", ") } : {}) };
}

/** Release tags dropped, year kept in brackets: "The Grand Budapest Hotel (2014)"; edition tags come out as `edition`. */
function tidyParts(text: string): { text: string; edition?: string } {
  const { list, edition } = withoutEditions(dehyphen(words(text)));
  const kept = untagged(list);
  const yearAt = kept.findLastIndex((w, i) => i > 0 && YEAR.test(w));
  const out =
    yearAt === -1 ? kept.join(" ") : `${kept.slice(0, yearAt).join(" ")} (${kept[yearAt]})`;
  return { text: out, ...(edition ? { edition } : {}) };
}

function tidy(text: string): string {
  return tidyParts(text).text;
}

/** A video's title. Episodes carry series, season and episode; `name` is what tiles and the player show. */
export interface Title {
  series?: string;
  season?: number;
  episode?: number;
  /** The episode's name ("Episode N" when the file has none), or the whole cleaned title for non-episodes. */
  name: string;
  /** Films: "Extended", "Director's Cut"… taken out of the title. */
  edition?: string;
}

const EPISODE =
  /(?<!\d)(?:s(?:eason)?[ ._-]*(\d{1,2})[ ._-]*(?:episode|ep|e)[ ._-]*(\d{1,3})|(\d{1,2})x(\d{2,3}))(?!\d)/i;
/** "Ep 1", "Episode 1", "E01": an episode whose season comes from its folder. */
const BARE_EPISODE = /(?<![a-z\d])(?:(?:episode|ep)[ ._-]*(\d{1,3})|e(\d{2,3}))(?![a-z\d])/i;

/** "Arcane S01E01 Welcome to the Playground.mkv" → { series: "Arcane", season: 1, episode: 1, name: "Welcome to the Playground" }. */
export function parseTitle(fileName: string): Title {
  const ext = extname(fileName).toLowerCase();
  const stem = VIDEO_EXTENSIONS.includes(ext) ? fileName.slice(0, -ext.length) : fileName;
  const normal = stem.replace(/[._]+/g, " ");
  const full = EPISODE.exec(normal);
  const m = full ?? BARE_EPISODE.exec(normal);
  if (m) {
    const bare = !full;
    const season = bare ? undefined : Number(m[1] ?? m[3]);
    const episode = Number(bare ? (m[1] ?? m[2]) : (m[2] ?? m[4]));
    const series = tidy(normal.slice(0, m.index).replace(/[-–:\s]+$/, ""));
    const name = untagged(words(normal.slice(m.index + m[0].length)), 0)
      .join(" ")
      .replace(/^[-–:\s]+|[-–:\s]+$/g, "");
    return {
      ...(series ? { series } : {}),
      ...(season === undefined ? {} : { season }),
      episode,
      name: name || `Episode ${episode}`,
    };
  }
  const { text, edition } = tidyParts(stem);
  return { name: text || stem, ...(edition ? { edition } : {}) };
}

/** A file name's cleaned title, ignoring any episode marker. */
export function plainTitle(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  const stem = VIDEO_EXTENSIONS.includes(ext) ? fileName.slice(0, -ext.length) : fileName;
  return tidy(stem) || stem;
}

/** "The.Grand.Budapest.Hotel.2014.1080p.BluRay.x264.mkv" → "The Grand Budapest Hotel (2014)"; episodes give their name. */
export function cleanTitle(fileName: string): string {
  const t = parseTitle(fileName);
  return t.episode !== undefined && t.season === undefined ? plainTitle(fileName) : t.name;
}

/** "Arcane · S1 E1" for episodes; undefined for anything else. */
export function episodeLine(fileName: string): string | undefined {
  const t = parseTitle(fileName);
  if (t.episode === undefined || t.season === undefined) return undefined;
  const code = `S${t.season} E${t.episode}`;
  return t.series ? `${t.series} · ${code}` : code;
}

/** What a video's tiles, overlay and phone show for it: its title and, for episodes, the "Series · S1 E1" line (for films, the edition). */
export function presentation(path: string): { title: string; line?: string } {
  const file = basename(path);
  const t = parseTitle(file);
  const line = episodeLine(file) ?? t.edition;
  return { title: cleanTitle(file), ...(line ? { line } : {}) };
}

/** A folder's name with the same release-tag cleanup as files. */
export function cleanFolderName(name: string): string {
  return tidy(name) || name;
}

/** A stable hue (0–359) for a tile's plain colour. */
export function hueFor(title: string): number {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function isDir(parent: string, e: Dirent): boolean {
  if (e.isDirectory()) return true;
  if (!e.isSymbolicLink()) return false;
  try {
    return statSync(join(parent, e.name)).isDirectory();
  } catch {
    return false;
  }
}

/** Reads a folder fresh: subfolders first, then videos, each in natural order. Undefined if unreadable. */
export function listFolder(path: string): LibraryEntry[] | undefined {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(path, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const visible = dirents.filter((e) => !e.name.startsWith("."));
  const folders = visible
    .filter((e) => isDir(path, e))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((e): LibraryEntry => ({
      kind: "folder",
      path: join(path, e.name),
      title: cleanFolderName(e.name),
      hue: hueFor(e.name),
    }));
  const videos = visible
    .filter((e) => !isDir(path, e) && VIDEO_EXTENSIONS.includes(extname(e.name).toLowerCase()))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((e): LibraryEntry => {
      const full = join(path, e.name);
      const { title, line } = presentation(full);
      return { kind: "video", path: full, title, ...(line ? { line } : {}), hue: hueFor(title) };
    });
  return [...folders, ...videos];
}

/** The Library's first page: one tile per added folder; missing ones are flagged. */
export function rootEntries(folders: string[]): LibraryEntry[] {
  return folders.map((path) => {
    const title = cleanFolderName(basename(path) || path);
    return {
      kind: "folder",
      path,
      title,
      hue: hueFor(title),
      missing: !existsSync(path),
    };
  });
}

/** Up to `max` video paths from inside a folder (its own videos first, then one level down), and how many entries it holds. */
export function mosaicSources(path: string, max = 4): { sources: string[]; count: number } {
  const entries = listFolder(path);
  if (!entries) return { sources: [], count: 0 };
  const sources = entries.filter((e) => e.kind === "video").map((e) => e.path);
  for (const sub of entries) {
    if (sources.length >= max) break;
    if (sub.kind !== "folder") continue;
    for (const e of listFolder(sub.path) ?? []) if (e.kind === "video") sources.push(e.path);
  }
  return { sources: sources.slice(0, max), count: entries.length };
}
