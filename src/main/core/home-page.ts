import { randomBytes } from "node:crypto";
import type { GridItem, HomePayload } from "../../shared/protocol.ts";
import {
  DEFAULT_WALLPAPER,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_DATA,
  PHOTO_ID,
  PHOTO_LIMIT,
  WALLPAPERS,
  dimFor,
  resolveChoice,
  type StoredPhoto,
  type WallpaperChoice,
} from "../../shared/wallpapers.ts";
import { looksLikeImage, type Photos } from "../ports/photos.ts";
import type { Store } from "../ports/store.ts";

const PICK = "home:wallpaper:";
const PHOTO = "home:photo:";
const ARTWORK = "home:artwork";
const ARTWORK_ID = "artwork";

export interface HomePageHost {
  store: Store;
  photos?: Photos;
  now(): number;
  toast(text: string): void;
  ask(title: string, buttons: [string, string], answers: [() => void, () => void]): void;
  changed(): void;
}

interface Saved {
  wallpaper?: unknown;
  artwork?: unknown;
  photos?: unknown;
}

/** Settings → Home: the wallpaper tiles (previewed as focus moves, chosen with OK), the household's photos and the artwork switch. */
export class HomePage {
  #h: HomePageHost;

  constructor(host: HomePageHost) {
    this.#h = host;
  }

  #saved(): Saved {
    return this.#h.store.read<Saved>("home", {});
  }

  /** The stored photos that are well formed; an odd id never becomes a file path. */
  #photos(): StoredPhoto[] {
    const list = this.#saved().photos;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p): p is StoredPhoto =>
        !!p &&
        typeof p.id === "string" &&
        PHOTO_ID.test(p.id) &&
        typeof p.dim === "number" &&
        typeof p.addedAt === "number",
    );
  }

  #chosen(): WallpaperChoice {
    return resolveChoice(this.#saved().wallpaper, this.#photos());
  }

  /** `previewId` is the focused tile while the Home page is open: it shows as `preview` without being saved. */
  payload(previewId?: string): HomePayload {
    const photos = this.#photos();
    const builtin = WALLPAPERS.find((w) => `wp:${w.id}` === previewId);
    const photo = photos.find((p) => `ph:${p.id}` === previewId);
    const preview: WallpaperChoice | undefined = builtin
      ? { kind: "builtin", id: builtin.id }
      : photo && { kind: "photo", id: photo.id };
    const photoTiles = this.#h.photos
      ? photos.map((p) => ({ id: p.id, dim: p.dim, url: this.#h.photos!.url(p.id) }))
      : [];
    return {
      wallpaper: this.#chosen(),
      ...(preview ? { preview } : {}),
      artwork: this.#saved().artwork !== false,
      ...(photoTiles.length ? { photos: photoTiles } : {}),
    };
  }

  grid(): GridItem[] {
    const chosen = this.#chosen();
    const photos = this.#h.photos ? this.#photos() : [];
    return [
      ...WALLPAPERS.map((w, c) => ({
        id: `wp:${w.id}`,
        r: 0,
        c,
        label: w.label,
        action: `${PICK}${w.id}`,
        ...(chosen.kind === "builtin" && w.id === chosen.id ? { initial: true } : {}),
      })),
      ...photos.map((p, i) => ({
        id: `ph:${p.id}`,
        r: 0,
        c: WALLPAPERS.length + i,
        label: "Photo",
        action: `${PHOTO}${p.id}`,
        ...(chosen.kind === "photo" && p.id === chosen.id ? { initial: true } : {}),
      })),
      { id: ARTWORK_ID, r: 1, c: 0, label: "Show artwork behind Resume", action: ARTWORK },
    ];
  }

  action(action: string): boolean {
    if (action === ARTWORK) {
      this.#write({ artwork: this.#saved().artwork === false });
    } else if (action.startsWith(PICK)) {
      const w = WALLPAPERS.find((x) => x.id === action.slice(PICK.length));
      if (!w) return true;
      this.#write({ wallpaper: { kind: "builtin", id: w.id } });
    } else if (action.startsWith(PHOTO)) {
      this.#photoMenu(action.slice(PHOTO.length));
      this.#h.changed();
      return true;
    } else return false;
    this.#h.changed();
    return true;
  }

  #photoMenu(id: string): void {
    if (!this.#photos().some((p) => p.id === id)) return;
    this.#h.ask(
      "This photo",
      ["Use", "Remove"],
      [
        () => {
          if (!this.#photos().some((p) => p.id === id)) return;
          this.#write({ wallpaper: { kind: "photo", id } });
        },
        () =>
          this.#h.ask(
            "Remove this photo?",
            ["Cancel", "Remove"],
            [() => {}, () => this.#remove(id)],
          ),
      ],
    );
  }

  #remove(id: string): void {
    const photos = this.#photos();
    if (!photos.some((p) => p.id === id)) return;
    this.#h.photos?.remove(id);
    const current = this.#chosen();
    this.#write({
      photos: photos.filter((p) => p.id !== id),
      ...(current.kind === "photo" && current.id === id ? { wallpaper: DEFAULT_WALLPAPER } : {}),
    });
  }

  /** A photo from a phone, as base64: checked, re-encoded as JPEG, saved, and made the wallpaper (after asking, if six are kept). */
  addPhoto(data: string | undefined): void {
    const fail = (text: string) => {
      this.#h.toast(text);
      this.#h.changed();
    };
    if (!this.#h.photos) return fail("Photos aren't available");
    if (data === undefined) return fail("That photo is too big or didn't arrive");
    if (data.length > MAX_PHOTO_DATA) return fail("That photo is too big");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_PHOTO_BYTES) return fail("That photo is too big");
    if (!looksLikeImage(bytes)) return fail("Couch can only use JPEG or PNG photos");
    let encoded;
    try {
      encoded = this.#h.photos.encode(bytes);
    } catch {
      encoded = undefined;
    }
    if (!encoded) return fail("Couch couldn't read that photo");
    const { jpeg, brightness } = encoded;
    const keep = () => this.#keep(jpeg, dimFor(brightness));
    if (this.#photos().length >= PHOTO_LIMIT) {
      this.#h.ask("Replace the oldest photo?", ["Cancel", "Replace"], [() => {}, keep]);
      this.#h.changed();
    } else keep();
  }

  #keep(jpeg: Buffer, dim: number): void {
    const photos = this.#h.photos;
    if (!photos) return;
    const id = randomBytes(6).toString("hex");
    let list = this.#photos();
    try {
      photos.save(id, jpeg);
    } catch {
      this.#h.toast("Couch couldn't save that photo");
      return;
    }
    while (list.length >= PHOTO_LIMIT) {
      const oldest = list.reduce((a, b) => (b.addedAt < a.addedAt ? b : a));
      photos.remove(oldest.id);
      list = list.filter((p) => p !== oldest);
    }
    this.#write({
      photos: [...list, { id, dim, addedAt: this.#h.now() }],
      wallpaper: { kind: "photo", id },
    });
  }

  #write(change: Saved): void {
    this.#h.store.write("home", { ...this.#saved(), ...change });
  }
}
