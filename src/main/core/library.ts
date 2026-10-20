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

/** Release tags dropped, year kept in brackets: "The Grand Budapest Hotel (2014)". */
function tidy(text: string): string {
  const kept = untagged(words(text));
  const yearAt = kept.findLastIndex((w, i) => i > 0 && YEAR.test(w));
  if (yearAt === -1) return kept.join(" ");
  return `${kept.slice(0, yearAt).join(" ")} (${kept[yearAt]})`;
}

/** A video's title. Episodes carry series, season and episode; `name` is what tiles and the player show. */
export interface Title {
  series?: string;
  season?: number;
  episode?: number;
  /** The episode's name ("Episode N" when the file has none), or the whole cleaned title for non-episodes. */
  name: string;
}

const EPISODE = /(?<!\d)(?:s(\d{1,2})[ ._-]*e(\d{1,3})|(\d{1,2})x(\d{2,3}))(?!\d)/i;

/** "Arcane S01E01 Welcome to the Playground.mkv" → { series: "Arcane", season: 1, episode: 1, name: "Welcome to the Playground" }. */
export function parseTitle(fileName: string): Title {
  const ext = extname(fileName).toLowerCase();
  const stem = VIDEO_EXTENSIONS.includes(ext) ? fileName.slice(0, -ext.length) : fileName;
  const normal = stem.replace(/[._]+/g, " ");
  const m = EPISODE.exec(normal);
  if (m) {
    const season = Number(m[1] ?? m[3]);
    const episode = Number(m[2] ?? m[4]);
    const series = tidy(normal.slice(0, m.index).replace(/[-–:\s]+$/, ""));
    const name = untagged(words(normal.slice(m.index + m[0].length)), 0)
      .join(" ")
      .replace(/^[-–:\s]+|[-–:\s]+$/g, "");
    return {
      ...(series ? { series } : {}),
      season,
      episode,
      name: name || `Episode ${episode}`,
    };
  }
  return { name: tidy(stem) || stem };
}

/** "The.Grand.Budapest.Hotel.2014.1080p.BluRay.x264.mkv" → "The Grand Budapest Hotel (2014)"; episodes give their name. */
export function cleanTitle(fileName: string): string {
  return parseTitle(fileName).name;
}

/** "Arcane · S1 E1" for episodes; undefined for anything else. */
export function episodeLine(fileName: string): string | undefined {
  const t = parseTitle(fileName);
  if (t.episode === undefined) return undefined;
  const code = `S${t.season} E${t.episode}`;
  return t.series ? `${t.series} · ${code}` : code;
}

/** What a video's tiles, overlay and phone show for it: its title and, for episodes, the "Series · S1 E1" line. */
export function presentation(path: string): { title: string; line?: string } {
  const file = basename(path);
  const line = episodeLine(file);
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
