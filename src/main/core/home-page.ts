import type { GridItem, HomePayload } from "../../shared/protocol.ts";
import { DEFAULT_WALLPAPER, WALLPAPERS, resolveWallpaper } from "../../shared/wallpapers.ts";
import type { Store } from "../ports/store.ts";

const PICK = "home:wallpaper:";
const ARTWORK = "home:artwork";
const ARTWORK_ID = "artwork";

export interface HomePageHost {
  store: Store;
  changed(): void;
}

interface Saved {
  wallpaper?: unknown;
  artwork?: unknown;
}

/** Settings → Home: the wallpaper tiles (previewed as focus moves, chosen with OK) and the artwork switch. */
export class HomePage {
  #h: HomePageHost;

  constructor(host: HomePageHost) {
    this.#h = host;
  }

  #saved(): Saved {
    return this.#h.store.read<Saved>("home", {});
  }

  #chosen(): string {
    return resolveWallpaper(this.#saved().wallpaper).id;
  }

  /** `previewId` is the focused tile while the Home page is open: it shows without being saved. */
  payload(previewId?: string): HomePayload {
    const preview = WALLPAPERS.find((w) => `wp:${w.id}` === previewId);
    return {
      wallpaper: preview
        ? { kind: "builtin", id: preview.id }
        : { ...DEFAULT_WALLPAPER, id: this.#chosen() },
      artwork: this.#saved().artwork !== false,
    };
  }

  grid(): GridItem[] {
    const chosen = this.#chosen();
    return [
      ...WALLPAPERS.map((w, c) => ({
        id: `wp:${w.id}`,
        r: 0,
        c,
        label: w.label,
        action: `${PICK}${w.id}`,
        ...(w.id === chosen ? { initial: true } : {}),
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
    } else return false;
    this.#h.changed();
    return true;
  }

  #write(change: Saved): void {
    this.#h.store.write("home", { ...this.#saved(), ...change });
  }
}
