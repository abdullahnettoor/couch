import { GLASS, type Look } from "../shared/look.ts";
import { pointerPixels, type PointerDraw, type PointerPixels } from "../shared/pointer.ts";

/** The native click-through overlay (the add-on). */
export interface NativePointer {
  setStyle(style: PointerPixels): void;
  place(x: number, y: number, shown: boolean): void;
}

/** Draws the pointer where Core says: in the native overlay when there is one, else through the renderer. */
export class PointerPresenter {
  #native: NativePointer | undefined;
  #fallback: (draw: PointerDraw) => void;
  #width: () => number;
  #look: Look;
  #styledAt = 0;

  constructor(options: {
    native: NativePointer | undefined;
    /** Where the renderer draws it, when there is no native overlay. */
    fallback: (draw: PointerDraw) => void;
    /** The window's content width in pixels. */
    width: () => number;
    look?: Look;
  }) {
    this.#native = options.native;
    this.#fallback = options.fallback;
    this.#width = options.width;
    this.#look = options.look ?? GLASS;
  }

  /** True when the native overlay draws it (the renderer's fallback stays off). */
  get native(): boolean {
    return this.#native !== undefined;
  }

  draw(draw: PointerDraw): void {
    if (!this.#native) return this.#fallback(draw);
    const width = this.#width();
    if (width !== this.#styledAt) {
      this.#styledAt = width;
      this.#native.setStyle(pointerPixels(this.#look, width));
    }
    this.#native.place(draw.x, draw.y, draw.shown);
  }
}
