import { createHash } from "node:crypto";
import type { GridItem, HomePayload } from "../../shared/protocol.ts";
import {
  CACHE_KEY,
  DEFAULT_WALLPAPER,
  FOLDER_LIMIT,
  SLIDESHOW_MS,
  WALLPAPERS,
  dimFor,
  isFileName,
  parseChoice,
  tidyName,
  type PictureKind,
  type PictureTile,
  type Slideshow,
  type WallpaperChoice,
} from "../../shared/wallpapers.ts";
import type { MacEntry, WallpaperPorts } from "../ports/pictures.ts";
import type { Clock } from "../ports/clock.ts";
import type { Store } from "../ports/store.ts";

const PICK = "home:wallpaper:";
const PIC = "home:pic:";
const ARTWORK = "home:artwork";
const FOLDER = "home:folder";
const SLIDESHOW = "home:slideshow";
const ARTWORK_ID = "artwork";
const FOLDER_ID = "folder";
const SLIDESHOW_ID = "slideshow";

/** Home re-reads the Mac's desktop picture at most this often. */
const READ_EVERY = 60_000;
const IMAGE_FILE = /\.(jpe?g|png|heic)$/i;
const SLIDESHOW_ORDER: Slideshow[] = ["off", "hour", "day"];

export interface HomePageHost {
  store: Store;
  /** The Mac's pictures; without it only the built-in wallpapers are offered. */
  wallpapers?: WallpaperPorts;
  clock: Clock;
  toast(text: string): void;
  changed(): void;
}

interface Saved {
  wallpaper?: unknown;
  artwork?: unknown;
  folder?: unknown;
  slideshow?: unknown;
  slideshowAt?: unknown;
  /** The dim of each converted copy, by key. */
  dims?: unknown;
  /** Ticket 107's phone photos; migrated away. */
  photos?: unknown;
}

/** A picture on the Mac that Settings offers: what it is, where it is, and the key its converted copy is kept under. */
interface Source {
  kind: PictureKind;
  file?: string;
  label: string;
  entry: MacEntry;
  key: string;
}

const keyFor = (e: MacEntry) =>
  createHash("sha1").update(`${e.path}\0${e.size}\0${e.mtimeMs}`).digest("hex").slice(0, 12);

const byName = (a: MacEntry, b: MacEntry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");

/** Settings → Home: the wallpaper tiles (previewed as focus moves, chosen with OK), the Mac's pictures and their conversion, the folder and the slideshow. */
export class HomePage {
  #h: HomePageHost;
  #sources: Source[] = [];
  #failed = new Set<string>();
  #queue: Source[] = [];
  /** The key being converted right now. */
  #running: string | undefined;
  #readAt: number | undefined;
  #desktop: MacEntry | undefined;
  #desktopKnown = false;
  #reading = false;
  #watching = true;
  #cancelRead: (() => void) | undefined;

  constructor(host: HomePageHost) {
    this.#h = host;
    this.#migrate();
    this.refresh(false);
  }

  #saved(): Saved {
    return this.#h.store.read<Saved>("home", {});
  }

  /** Ticket 107's phone photos are gone: their files are removed and a photo choice goes back to Couch. */
  #migrate(): void {
    const saved = this.#saved();
    const old = saved.photos;
    const chosen = saved.wallpaper as { kind?: unknown } | undefined;
    if (old === undefined && chosen?.kind !== "photo") return;
    if (Array.isArray(old))
      for (const p of old) {
        const id = (p as { id?: unknown } | null)?.id;
        if (typeof id === "string" && CACHE_KEY.test(id)) this.#h.wallpapers?.files.remove(id);
      }
    const { photos: _photos, ...rest } = saved;
    this.#h.store.write("home", {
      ...rest,
      ...(chosen?.kind === "photo" ? { wallpaper: DEFAULT_WALLPAPER } : {}),
    });
  }

  #folder(): string {
    const f = this.#saved().folder;
    return typeof f === "string" && f.startsWith("/") ? f : this.#h.wallpapers!.mac.defaultFolder();
  }

  #slideshow(): Slideshow {
    const s = this.#saved().slideshow;
    return s === "hour" || s === "day" ? s : "off";
  }

  #dims(): Record<string, number> {
    const d = this.#saved().dims;
    return d && typeof d === "object" ? { ...(d as Record<string, number>) } : {};
  }

  /** The stored choice, kept only while its picture exists on the Mac; anything else shows as Couch. */
  #chosen(): WallpaperChoice {
    const choice = parseChoice(this.#saved().wallpaper);
    if (choice.kind === "builtin") return choice;
    // Until the first read of the desktop picture is back, Same as Mac is kept rather than shown as Couch.
    if (choice.kind === "mac" && !this.#desktopKnown) return choice;
    return this.#find(choice) ? choice : DEFAULT_WALLPAPER;
  }

  #find(choice: WallpaperChoice): Source | undefined {
    if (choice.kind === "builtin") return undefined;
    return this.#sources.find(
      (s) => s.kind === choice.kind && (choice.kind === "mac" || s.file === choice.file),
    );
  }

  /**
   * Reads the Mac again. `full` (Settings → Home is open) lists everything and converts every picture;
   * otherwise it is Home, at most once a minute, and only the picture in use is converted. The desktop
   * picture is read in the background; the next read is due 60 s after this one.
   */
  refresh(full: boolean): void {
    const w = this.#h.wallpapers;
    if (!w) return;
    const now = this.#h.clock.now();
    if (!full && this.#readAt !== undefined && now - this.#readAt < READ_EVERY) return;
    this.#readAt = now;
    this.#rebuild(full);
    this.#armRead();
    if (this.#reading) return;
    this.#reading = true;
    const done = (desktop: MacEntry | undefined, ok: boolean) => {
      this.#reading = false;
      if (ok) this.#desktop = desktop;
      this.#desktopKnown = true;
      this.#rebuild(full);
      this.#h.changed();
    };
    w.mac.desktopPicture().then(
      (d) => done(d, true),
      () => done(undefined, false),
    );
  }

  /** Home is up (or Settings → Home): the desktop picture is re-read 60 s after the last read; elsewhere it isn't. */
  watch(on: boolean): void {
    this.#watching = on;
    if (on) this.#armRead();
    else this.#cancelRead?.();
  }

  #armRead(): void {
    this.#cancelRead?.();
    this.#cancelRead = undefined;
    if (!this.#watching || !this.#h.wallpapers || this.#readAt === undefined) return;
    const wait = Math.max(0, this.#readAt + READ_EVERY - this.#h.clock.now());
    this.#cancelRead = this.#h.clock.setTimeout(() => this.refresh(false), wait);
  }

  #rebuild(full: boolean): void {
    const w = this.#h.wallpapers!;
    const sources: Source[] = [];
    const add = (kind: PictureKind, entry: MacEntry, label: string, file?: string) =>
      sources.push({ kind, entry, label, ...(file ? { file } : {}), key: keyFor(entry) });
    const desktop = this.#desktop;
    if (desktop && IMAGE_FILE.test(desktop.name)) add("mac", desktop, "Same as Mac");
    const listed = w.mac.listFolder(this.#folder());
    const folder = (listed ?? [])
      .filter((e) => e.kind === "file" && !e.name.startsWith(".") && IMAGE_FILE.test(e.name))
      .sort(byName)
      .slice(0, FOLDER_LIMIT);
    for (const e of folder) add("folder", e, tidyName(e.name), e.name);
    const apple = w.mac
      .appleWallpapers()
      .filter((e) => e.kind === "file" && /\.heic$/i.test(e.name) && !e.name.startsWith("."))
      .sort(byName);
    for (const e of apple) add("apple", e, tidyName(e.name), e.name);
    this.#sources = sources;
    this.#forget(listed !== undefined && this.#desktopKnown);
    const inUse = this.#find(parseChoice(this.#saved().wallpaper));
    for (const s of sources) if (full || s === inUse) this.#want(s);
    this.#preloadNext();
    this.#pump();
  }

  /** The next slideshow picture, so it is converted before it is due. */
  #nextSlide(): Source | undefined {
    const chosen = this.#chosen();
    if (this.#slideshow() === "off" || chosen.kind !== "folder") return undefined;
    const pictures = this.#sources.filter((s) => s.kind === "folder" && !this.#failed.has(s.key));
    const here = pictures.findIndex((s) => s.file === chosen.file);
    return here < 0 ? undefined : pictures[(here + 1) % pictures.length];
  }

  #preloadNext(): void {
    const next = this.#nextSlide();
    if (next) this.#want(next);
  }

  /** Converted copies of pictures that are in no source any more are removed (kept when the folder couldn't be read). */
  #forget(folderRead: boolean): void {
    const w = this.#h.wallpapers!;
    const live = new Set(this.#sources.map((s) => s.key));
    this.#failed = new Set([...this.#failed].filter((k) => live.has(k)));
    this.#queue = this.#queue.filter((s) => live.has(s.key));
    if (!folderRead) return;
    const dims = this.#dims();
    for (const key of w.files.keys()) if (!live.has(key)) w.files.remove(key);
    let changed = false;
    for (const key of Object.keys(dims))
      if (!live.has(key)) {
        delete dims[key];
        changed = true;
      }
    if (changed) this.#write({ dims });
  }

  #converted(s: Source): boolean {
    return this.#h.wallpapers!.files.has(s.key) && this.#dims()[s.key] !== undefined;
  }

  #want(s: Source): void {
    if (
      this.#failed.has(s.key) ||
      this.#running === s.key ||
      this.#converted(s) ||
      this.#queue.some((q) => q.key === s.key)
    )
      return;
    this.#queue.push(s);
  }

  #prioritize(s: Source): void {
    const at = this.#queue.findIndex((q) => q.key === s.key);
    if (at > 0) this.#queue.unshift(...this.#queue.splice(at, 1));
  }

  /** One conversion at a time, so a folder of large pictures never holds up the app. */
  #pump(): void {
    const w = this.#h.wallpapers;
    if (!w || this.#running) return;
    let next = this.#queue.shift();
    // A picture queued twice, or converted while it waited, is not decoded again.
    while (next && this.#converted(next)) next = this.#queue.shift();
    if (!next) return;
    const job = next;
    this.#running = job.key;
    const done = (converted: Awaited<ReturnType<typeof w.converter.convert>>) => {
      this.#running = undefined;
      if (!converted) this.#failed.add(job.key);
      else if (this.#sources.some((s) => s.key === job.key)) {
        try {
          w.files.save(job.key, converted.jpeg, converted.thumb);
          this.#write({ dims: { ...this.#dims(), [job.key]: dimFor(converted.brightness) } });
        } catch {
          this.#failed.add(job.key);
        }
      }
      this.#slide();
      this.#h.changed();
      this.#pump();
    };
    const { path, size, dev, ino } = job.entry;
    w.converter.convert(path, { size, dev, ino }).then(done, () => done(undefined));
  }

  /** Called on each minute: moves the slideshow on when it is due. */
  tick(_onHome?: boolean): void {
    if (!this.#h.wallpapers) return;
    if (this.#slideshow() === "off") return;
    if (typeof this.#saved().slideshowAt !== "number")
      return this.#write({ slideshowAt: this.#h.clock.now() });
    this.#slide();
  }

  /** When the slideshow is due and the next picture is converted, Home moves to it; until then the current one stays. */
  #slide(): void {
    const mode = this.#slideshow();
    const at = this.#saved().slideshowAt;
    if (mode === "off" || typeof at !== "number") return;
    const now = this.#h.clock.now();
    if (now - at < SLIDESHOW_MS[mode]) return;
    const next = this.#nextSlide();
    if (!next) return;
    if (!this.#converted(next)) {
      this.#want(next);
      this.#prioritize(next);
      this.#pump();
      return;
    }
    this.#write({ wallpaper: { kind: "folder", file: next.file! }, slideshowAt: now });
    this.#preloadNext();
    this.#pump();
    this.#h.changed();
  }

  #tile(s: Source): PictureTile {
    const w = this.#h.wallpapers!;
    const dim = this.#dims()[s.key];
    const ready = w.files.has(s.key) && dim !== undefined;
    return {
      kind: s.kind,
      ...(s.file ? { file: s.file } : {}),
      label: s.label,
      ...(ready ? { url: w.files.url(s.key), thumb: w.files.thumbUrl(s.key), dim } : {}),
    };
  }

  /** Same as Mac first (always offered), then the folder's pictures, then Apple's; pictures that failed their checks are left out. */
  #tiles(): PictureTile[] {
    if (!this.#h.wallpapers) return [];
    const shown = this.#sources.filter((s) => !this.#failed.has(s.key));
    const mac = shown.find((s) => s.kind === "mac");
    return [
      mac ? this.#tile(mac) : { kind: "mac", label: "Same as Mac" },
      ...shown.filter((s) => s.kind !== "mac").map((s) => this.#tile(s)),
    ];
  }

  /** `previewId` is the focused tile while the Home page is open: it shows as `preview` without being saved. */
  payload(previewId?: string): HomePayload {
    const w = this.#h.wallpapers;
    const builtin = WALLPAPERS.find((x) => `wp:${x.id}` === previewId);
    let preview: WallpaperChoice | undefined = builtin && { kind: "builtin", id: builtin.id };
    if (!preview && w && previewId?.startsWith("pic:")) {
      const s = this.#byTileId(previewId);
      if (s) {
        preview = s.kind === "mac" ? { kind: "mac" } : { kind: s.kind, file: s.file! };
        this.#prioritize(s);
      }
    }
    return {
      wallpaper: this.#chosen(),
      ...(preview ? { preview } : {}),
      artwork: this.#saved().artwork !== false,
      ...(w
        ? {
            pictures: this.#tiles(),
            folder: shortPath(this.#folder()),
            slideshow: this.#slideshow(),
          }
        : {}),
    };
  }

  #byTileId(id: string): Source | undefined {
    const rest = id.slice("pic:".length);
    if (rest === "mac") return this.#sources.find((s) => s.kind === "mac");
    const at = rest.indexOf(":");
    const kind = rest.slice(0, at);
    const file = rest.slice(at + 1);
    if ((kind !== "folder" && kind !== "apple") || !isFileName(file)) return undefined;
    return this.#sources.find((s) => s.kind === kind && s.file === file);
  }

  grid(): GridItem[] {
    const chosen = this.#chosen();
    const items: GridItem[] = WALLPAPERS.map((w, c) => ({
      id: `wp:${w.id}`,
      r: 0,
      c,
      label: w.label,
      action: `${PICK}${w.id}`,
      ...(chosen.kind === "builtin" && w.id === chosen.id ? { initial: true } : {}),
    }));
    this.#tiles().forEach((p, i) => {
      const id = p.kind === "mac" ? "mac" : `${p.kind}:${p.file}`;
      items.push({
        id: `pic:${id}`,
        r: 0,
        c: WALLPAPERS.length + i,
        label: p.label,
        action: `${PIC}${id}`,
        ...(chosen.kind === p.kind && (chosen.kind === "mac" || chosen.file === p.file)
          ? { initial: true }
          : {}),
      });
    });
    items.push({
      id: ARTWORK_ID,
      r: 1,
      c: 0,
      label: "Show artwork behind Resume",
      action: ARTWORK,
    });
    if (this.#h.wallpapers) {
      items.push(
        { id: FOLDER_ID, r: 2, c: 0, label: "Wallpaper folder", action: FOLDER },
        { id: SLIDESHOW_ID, r: 3, c: 0, label: "Slideshow", action: SLIDESHOW },
      );
    }
    return items;
  }

  action(action: string): boolean {
    if (action === ARTWORK) {
      this.#write({ artwork: this.#saved().artwork === false });
    } else if (action.startsWith(PICK)) {
      const w = WALLPAPERS.find((x) => x.id === action.slice(PICK.length));
      if (!w) return true;
      this.#choose({ kind: "builtin", id: w.id });
    } else if (action.startsWith(PIC)) {
      this.#choosePicture(action.slice(PIC.length));
    } else if (action === FOLDER) {
      this.#chooseFolder();
      return true;
    } else if (action === SLIDESHOW) {
      const next = SLIDESHOW_ORDER[(SLIDESHOW_ORDER.indexOf(this.#slideshow()) + 1) % 3]!;
      this.#write({ slideshow: next, slideshowAt: this.#h.clock.now() });
    } else return false;
    this.#h.changed();
    return true;
  }

  #choosePicture(id: string): void {
    const s = this.#byTileId(`pic:${id}`);
    if (!s || this.#failed.has(s.key)) {
      if (id === "mac") this.#h.toast("Couch can't use the Mac's desktop picture");
      return;
    }
    this.#choose(s.kind === "mac" ? { kind: "mac" } : { kind: s.kind, file: s.file! });
    this.#want(s);
    this.#prioritize(s);
    this.#pump();
  }

  #choose(choice: WallpaperChoice): void {
    this.#write({ wallpaper: choice, slideshowAt: this.#h.clock.now() });
  }

  #chooseFolder(): void {
    const w = this.#h.wallpapers;
    if (!w) return;
    w.mac.chooseFolder(this.#folder()).then(
      (path) => {
        if (!path || !path.startsWith("/")) return;
        this.#write({ folder: path });
        this.refresh(true);
        this.#h.changed();
      },
      () => this.#h.toast("Couch couldn't open the folder chooser"),
    );
  }

  #write(change: Saved): void {
    this.#h.store.write("home", { ...this.#saved(), ...change });
  }
}
