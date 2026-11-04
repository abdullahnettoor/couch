import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  VIEW_LABELS,
  type GridItem,
  type LibraryChip,
  type LibraryEntry,
  type LibraryPayload,
  type ScreenPayload,
  type View,
} from "../../../shared/protocol.ts";
import { resolveFocus } from "../focus.ts";
import type { History } from "../history.ts";
import { listFolder, mosaicSources, rootEntries } from "../library.ts";
import { autoRows, chipsFor, keepFor } from "../library-chips.ts";
import { libraryRows, tileAction } from "../library-rows.ts";
import type { MediaLibrary } from "../media-library.ts";
import type { MetadataService } from "../metadata-service.ts";
import type { ThumbnailScheduler } from "../thumbnail-scheduler.ts";
import { GLASS } from "../../../shared/look.ts";
import type { FolderContext, Page, PageBack } from "./page.ts";

/** The Library's first page wraps its tiles at this many a row, and so does a folder. */
export const TILE_COLUMNS = GLASS.metrics.library.tileColumns;

/** Coming back from these never refreshed the Library: they changed the view without the view-change path. */
const NO_REFRESH_FROM: View[] = ["folder", "player", "fixMatch"];
/** Coming back from these puts focus on the tile it was on. */
const KEEPS_TILE_FROM: View[] = ["show", "fixMatch"];

/** What the Library Page asks of the core. */
export interface LibraryPageHost {
  library: MediaLibrary;
  details: MetadataService;
  history: History;
  thumbs: ThumbnailScheduler;
  /** Adds progress or the watched tag to a video entry. */
  decorate(entry: LibraryEntry): LibraryEntry;
  /** The Library's own Continue watching row. */
  continueEntries(): LibraryEntry[];
  folders(): string[];
  playContinue(path: string, fromStart?: boolean): void;
  openShow(id: string): void;
  openSearch(): void;
}

/**
 * The Library's first page, a folder (one Page for both views):
 * the grid, the payload, the `library:*` actions, Back, and refreshing on arrival.
 */
export class LibraryPage implements Page {
  #ctx: FolderContext;
  #h: LibraryPageHost;
  /** The folder open now: its entries. */
  #listing: LibraryEntry[] = [];
  #mosaics = new Map<string, { sources: string[]; count: number }>();
  #rootKey: string | undefined;
  /** The active filter chip on the first page (a chip key), if any. */
  #chip: string | undefined;
  /** The tile focused on the first page, so rows that change under it don't move focus. */
  #rootFocusId: string | undefined;
  /** The last tile focused on the first page; the featured area keeps showing it while a chip or icon has focus. */
  #lastTile: string | undefined;

  constructor(ctx: FolderContext, host: LibraryPageHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  /** Home forgets the chip. */
  resetChip(): void {
    this.#chip = undefined;
    this.#lastTile = undefined;
  }

  /** The Remote's "Library · Movies" line, while a chip filters the first page. */
  chipLine(): string | undefined {
    if (this.#ctx.state.view !== "library" || !this.#chip) return undefined;
    return `Library · ${this.#chips().find((c) => c.active)?.label ?? ""}`;
  }

  /** The tile focused on the first page, if any (Fix match, Menu). */
  focusedEntry(): LibraryEntry | undefined {
    const focused = resolveFocus(this.grid(), this.#ctx.focusOf(this.#ctx.viewKey()));
    return this.#rows()
      .rows.flatMap((r) => r.entries)
      .find((e) => (e.id ?? e.path) === focused?.id);
  }

  /** The tile focused on the first page stays where it is when rows change under it. */
  keepFocus(): void {
    if (this.#ctx.state.view !== "library" || !this.#rootFocusId) return;
    const at = this.grid().find((i) => i.id === this.#rootFocusId);
    if (at) this.#ctx.setFocus(this.#ctx.viewKey(), { r: at.r, c: at.c });
  }

  /** Focus a video's tile in the open folder, if listed. */
  focusEntry(path: string, next = false): void {
    let index = this.#listing.findIndex((e) => e.path === path);
    if (index === -1) return;
    if (next) {
      const after = this.#listing.slice(index + 1).findIndex((e) => e.kind === "video");
      if (after !== -1) index += 1 + after;
    }
    this.#ctx.setFocus(`folder:${this.#ctx.state.folderPath}`, {
      r: 1 + Math.floor(index / TILE_COLUMNS),
      c: index % TILE_COLUMNS,
    });
  }

  enter(from: View): void {
    if (this.#ctx.state.view !== "library") return;
    if (KEEPS_TILE_FROM.includes(from)) this.keepFocus();
    if (!NO_REFRESH_FROM.includes(from)) void this.#h.library.refresh(this.#h.folders());
  }

  /** On arriving at the first page, finds each folder's mosaic sources and queues their pictures. */
  sync(): void {
    if (this.#ctx.state.view !== "library") {
      this.#rootKey = undefined;
      return;
    }
    const rows = this.#rows();
    const folders = this.#h.folders();
    const key = [...folders, "", ...rows.wanted].join("\0");
    if (this.#rootKey === key) return;
    this.#rootKey = key;
    this.#mosaics.clear();
    const paths: string[] = [...rows.wanted];
    for (const f of folders) {
      if (!existsSync(f)) continue;
      const m = mosaicSources(f);
      this.#mosaics.set(f, m);
      paths.push(...m.sources);
    }
    this.#h.thumbs.want(paths);
  }

  openFolder(path: string): void {
    const entries = listFolder(path);
    if (!entries) return this.#ctx.toast("Connect the drive to see this folder");
    this.#listing = entries;
    this.#mosaics.clear();
    const paths = entries.filter((e) => e.kind === "video").map((e) => e.path);
    for (const e of entries) {
      if (e.kind !== "folder") continue;
      const m = mosaicSources(e.path);
      this.#mosaics.set(e.path, m);
      paths.push(...m.sources);
    }
    this.#h.thumbs.want(paths);
    this.#ctx.setFolder(path);
    this.#ctx.go("folder");
  }

  back(): PageBack | undefined {
    const { view, folderPath } = this.#ctx.state;
    if (view === "folder") {
      const path = folderPath ?? "";
      return this.#toLibrary(path)
        ? { label: VIEW_LABELS.library, act: () => this.#leaveFolder() }
        : { label: basename(dirname(path)), act: () => this.openFolder(dirname(path)) };
    }
    if (this.#chip) {
      return {
        label: "All",
        act: () => {
          this.#chip = undefined;
          this.#ctx.setFocus(this.#ctx.viewKey(), { r: 1, c: 0 });
        },
      };
    }
    return { label: VIEW_LABELS.home, act: () => this.#ctx.go("home") };
  }

  /** Back from a folder leaves focus on the first page as it was. */
  #leaveFolder(): void {
    this.#ctx.go("library");
    this.#rootFocusId = undefined;
  }

  /** Whether a folder's Back goes up to the Library (a Library folder, or one outside every Library folder) rather than to its parent folder. */
  #toLibrary(path: string): boolean {
    const folders = this.#h.folders();
    return folders.includes(path) || !folders.some((f) => path.startsWith(f));
  }

  action(action: string): boolean {
    if (!action.startsWith("library:")) return false;
    const [, verb, ...rest] = action.split(":");
    const arg = rest.join(":");
    if (verb === "missing") this.#ctx.toast("Connect the drive to see this folder");
    else if (verb === "open") this.openFolder(arg);
    else if (verb === "play") this.#h.playContinue(arg);
    else if (verb === "playstart") this.#h.playContinue(arg, true);
    else if (verb === "search") this.#h.openSearch();
    else if (verb === "chip") {
      this.#chip = this.#chip === arg || arg === "all" ? undefined : arg;
      this.#lastTile = undefined;
    } else if (verb === "show") this.#h.openShow(arg);
    else return false;
    return true;
  }

  payload(focusedId?: string): Pick<ScreenPayload, "library"> {
    if (this.#ctx.state.view === "library") this.#rootFocusId = focusedId;
    return { library: this.#library(focusedId) };
  }

  grid(): GridItem[] {
    const lib = this.#library()!;
    const tile = (e: LibraryEntry, r: number, c: number, initial: boolean): GridItem => ({
      id: e.id ?? e.path,
      r,
      c,
      label: e.title,
      action: tileAction(e),
      initial,
    });
    // Row 0 is the top strip's gear, as on Home; the chips are row 1 when there are any; each page row is one grid row, Folders wrap below.
    const rows = lib.rows ?? [];
    const chips = lib.chips ?? [];
    const top = chips.length ? 2 : 1;
    const chipItems: GridItem[] = chips.map((c, i) => ({
      id: `chip:${c.key}`,
      r: 1,
      c: i,
      label: c.label,
      action: `library:chip:${c.key}`,
    }));
    const tiles = [
      ...rows.flatMap((row, r) =>
        row.entries.map((e, c) => tile(e, top + r, c, r === 0 && c === 0)),
      ),
      ...lib.entries.map((e, i) =>
        tile(
          e,
          top + rows.length + Math.floor(i / TILE_COLUMNS),
          i % TILE_COLUMNS,
          rows.length === 0 && i === 0,
        ),
      ),
    ];
    const gear: GridItem = {
      id: "settings",
      r: 0,
      c: 0,
      label: "Settings",
      action: "open:settings",
      initial: tiles.length === 0,
    };
    const search: GridItem = {
      id: "search",
      r: 0,
      c: -1,
      label: "Search",
      action: "library:search",
    };
    return [search, gear, ...chipItems, ...tiles];
  }

  /** The Library views are built here from disk. */
  #library(focusedId?: string): LibraryPayload | undefined {
    const folders = this.#h.folders();
    switch (this.#ctx.state.view) {
      case "library": {
        const rows = this.#rows().rows;
        const roots = this.#chip ? [] : rootEntries(folders);
        const ids = [...rows.flatMap((r) => r.entries), ...roots].map((e) => e.id ?? e.path);
        if (focusedId && ids.includes(focusedId)) this.#lastTile = focusedId;
        else if (this.#lastTile && !ids.includes(this.#lastTile)) this.#lastTile = undefined;
        const featuredId = this.#lastTile ?? ids[0];
        return {
          heading: "Library",
          entries: this.#chip
            ? []
            : rootEntries(folders).map((e) => ({
                ...this.#withMosaic(e),
                feature: { kind: "Folder" as const, title: e.title },
              })),
          continueWatching: this.#h.continueEntries(),
          rows,
          chips: this.#chips(),
          ...(featuredId ? { featuredId } : {}),
          emptyText: "No folders yet. Add one in Settings on the Mac.",
        };
      }
      case "folder":
        return {
          heading: basename(this.#ctx.state.folderPath ?? ""),
          entries: this.#listing.map((e) => this.#withMosaic(this.#h.decorate(e))),
          emptyText: "No videos in this folder.",
        };
      default:
        return undefined;
    }
  }

  /** The chip row; an active chip that no longer exists is dropped. */
  #chips(): LibraryChip[] {
    const make = () =>
      chipsFor({
        details: this.#h.details,
        shows: this.#h.library.shows().length,
        films: this.#h.library.films().length,
        active: this.#chip,
      });
    let chips = make();
    if (this.#chip && !chips.some((c) => c.key === this.#chip)) {
      this.#chip = undefined;
      chips = make();
    }
    return chips;
  }

  #rows(): ReturnType<typeof libraryRows> {
    const chips = this.#chips();
    return libraryRows({
      ...(this.#chip && chips.length
        ? { keep: keepFor(this.#chip, this.#h.details) }
        : this.#ctx.state.view === "library"
          ? { auto: autoRows(this.#h.details) }
          : {}),
      library: this.#h.library,
      history: this.#h.history,
      decorate: (e) => this.#h.decorate(e),
      continueEntries: this.#h.continueEntries(),
      thumb: (p) => this.#h.thumbs.urlFor(p),
      details: (id) => this.#h.details.detailsFor(id),
    });
  }

  /** A video's picture, or a folder's mosaic and count, from what has been made so far. */
  #withMosaic(entry: LibraryEntry): LibraryEntry {
    if (entry.kind === "video") {
      const thumb = this.#h.thumbs.urlFor(entry.path);
      return thumb ? { ...entry, thumb } : entry;
    }
    const m = this.#mosaics.get(entry.path);
    if (!m || entry.missing) return entry;
    const mosaic = m.sources.flatMap((p) => this.#h.thumbs.urlFor(p) ?? []);
    return { ...entry, count: m.count, ...(mosaic.length ? { mosaic } : {}) };
  }
}
