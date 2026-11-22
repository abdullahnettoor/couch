import type { Store } from "../ports/store.ts";
import type { TextSize } from "../web/text-size.ts";

const KEY = "text-size";
export const TEXT_SIZES: readonly TextSize[] = ["smaller", "default", "larger"];
export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  smaller: "Smaller",
  default: "Default",
  larger: "Larger",
};

interface Stored {
  default?: TextSize;
  apps?: Record<string, TextSize>;
}

const isSize = (v: unknown): v is TextSize => TEXT_SIZES.includes(v as TextSize);

/** The size one step from `size`, clamped at the ends (Left/Right) or wrapping (a row's OK). */
export function stepTextSize(size: TextSize, delta: number, wrap = false): TextSize {
  const at = TEXT_SIZES.indexOf(size) + delta;
  const n = TEXT_SIZES.length;
  return TEXT_SIZES[wrap ? (at + n) % n : Math.max(0, Math.min(n - 1, at))]!;
}

/**
 * The household's Text size (Store key `text-size`): a default for every App and a choice of its
 * own for any App that has one. Changing the default clears the App choices, so it stays one setting.
 */
export class TextSizeSetting {
  #store: Store;
  #default: TextSize | undefined;
  #apps = new Map<string, TextSize>();

  constructor(store: Store) {
    this.#store = store;
    const raw = store.read<Stored | null>(KEY, {}) ?? {};
    if (isSize(raw.default)) this.#default = raw.default;
    for (const [id, size] of Object.entries(raw.apps ?? {}))
      if (isSize(size)) this.#apps.set(id, size);
  }

  /** The household default: "default" until chosen. */
  get defaultSize(): TextSize {
    return this.#default ?? "default";
  }

  /** The household has chosen a default (Setup's step reads this). */
  get chosen(): boolean {
    return this.#default !== undefined;
  }

  /** An App's size: its own choice, else the default. */
  of(id: string): TextSize {
    return this.#apps.get(id) ?? this.defaultSize;
  }

  setDefault(size: TextSize): void {
    this.#default = size;
    this.#apps.clear();
    this.#save();
  }

  setApp(id: string, size: TextSize): void {
    this.#apps.set(id, size);
    this.#save();
  }

  #save(): void {
    this.#store.write(KEY, {
      ...(this.#default ? { default: this.#default } : {}),
      apps: Object.fromEntries(this.#apps),
    } satisfies Stored);
  }
}
