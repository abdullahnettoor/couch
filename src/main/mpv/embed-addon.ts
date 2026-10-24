import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { EmbedFactory } from "./mpv-player.ts";

interface Addon {
  create(handle: Buffer, options: Record<string, string>, libraryPath?: string): number;
  setVisible(id: number, visible: boolean): void;
  setGlass(
    id: number,
    slot: number,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    alpha: number,
  ): void;
  getColor(id: number): [number, number, number] | null;
  glassSupported(): boolean;
  destroy(id: number): void;
  setCursorHidden(hidden: boolean): void;
  watchMouseMoves(cb: () => void): void;
  unwatchMouseMoves(): void;
}

function loadAddon(): Addon {
  return createRequire(import.meta.url)(
    join(import.meta.dirname, "../../native/mpv-embed/mpv_embed.node"),
  ) as Addon;
}

/** Hides the Mac cursor until the mouse moves, or shows it; a no-op if the add-on isn't built. */
export function setCursorHidden(hidden: boolean): void {
  try {
    loadAddon().setCursorHidden?.(hidden);
  } catch {
    // no native add-on: the renderer's own idle cursor still applies
  }
}

/**
 * Calls `cb` on every mouse movement over Couch's window, whichever view is under the pointer
 * (an NSEvent local monitor). Returns a function that stops it; a no-op without the add-on.
 */
export function watchMouseMoves(cb: () => void): () => void {
  try {
    const addon = loadAddon();
    addon.watchMouseMoves(cb);
    return () => addon.unwatchMouseMoves();
  } catch {
    return () => {};
  }
}

/**
 * Loads native/mpv-embed (built by `pnpm run build:native`) and returns a factory that puts an
 * mpv-driven view inside `win`. Loading is lazy, so a missing add-on or libmpv only surfaces as
 * a throw from the factory, which MpvPlayer reports as `missing`.
 */
export function createEmbedFactory(win: () => BrowserWindow | undefined): EmbedFactory {
  return (options) => {
    const window = win();
    if (!window || window.isDestroyed()) throw new Error("no window to embed into");
    const addon = loadAddon();
    const id = addon.create(window.getNativeWindowHandle(), options, process.env.COUCH_LIBMPV);
    return {
      setVisible: (visible) => addon.setVisible(id, visible),
      nativeGlass: addon.glassSupported() && process.env.COUCH_NATIVE_GLASS !== "0",
      setGlass: (slot, rect) =>
        addon.setGlass(id, slot, rect.x, rect.y, rect.w, rect.h, rect.r, rect.alpha),
      getColor: () => addon.getColor(id),
      destroy: () => addon.destroy(id),
    };
  };
}
