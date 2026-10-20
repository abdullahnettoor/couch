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

/** "The.Grand.Budapest.Hotel.2014.1080p.BluRay.x264.mkv" → "The Grand Budapest Hotel (2014)". */
export function cleanTitle(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  const stem = VIDEO_EXTENSIONS.includes(ext) ? fileName.slice(0, -ext.length) : fileName;
  const words = stem
    .replace(/[._()[\]{}]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && TAGS.has(w.toLowerCase()));
  const kept = cut === -1 ? words : words.slice(0, cut);
  const yearAt = kept.findLastIndex((w, i) => i > 0 && YEAR.test(w));
  if (yearAt === -1) return kept.join(" ") || stem;
  return `${kept.slice(0, yearAt).join(" ")} (${kept[yearAt]})`;
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
      title: e.name,
      hue: hueFor(e.name),
    }));
  const videos = visible
    .filter((e) => !isDir(path, e) && VIDEO_EXTENSIONS.includes(extname(e.name).toLowerCase()))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((e): LibraryEntry => {
      const title = cleanTitle(e.name);
      return { kind: "video", path: join(path, e.name), title, hue: hueFor(title) };
    });
  return [...folders, ...videos];
}

/** The Library's first page: one tile per added folder; missing ones are flagged. */
export function rootEntries(folders: string[]): LibraryEntry[] {
  return folders.map((path) => {
    const title = basename(path) || path;
    return {
      kind: "folder",
      path,
      title,
      hue: hueFor(title),
      missing: !existsSync(path),
    };
  });
}
