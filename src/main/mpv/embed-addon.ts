import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DrawerGlass } from "../web/quick-drawer.ts";
import type { EmbedFactory } from "./mpv-player.ts";

type DrawerGlassRect = Parameters<DrawerGlass["open"]>[0];

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
  setDrawerGlass(
    handle: Buffer,
    open: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    ms: number,
  ): void;
  beginDrawerRegistration(handle: Buffer): void;
  endDrawerRegistration(handle: Buffer): boolean;
  hideDrawerGlass(): void;
  disposeWindow(): void;
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
 * The Quick settings drawer's native glass, or undefined when it isn't available (older macOS,
 * `COUCH_NATIVE_GLASS=0`, no add-on). Independent of the player: it works with no video loaded.
 */
export function createDrawerGlass(
  win: () => BrowserWindow | undefined,
  load: () => Pick<
    Addon,
    | "glassSupported"
    | "setDrawerGlass"
    | "beginDrawerRegistration"
    | "endDrawerRegistration"
    | "hideDrawerGlass"
  > = loadAddon,
): DrawerGlass | undefined {
  try {
    const addon = load();
    if (!addon.glassSupported() || process.env.COUCH_NATIVE_GLASS === "0") return undefined;
    const call = (open: boolean, r: DrawerGlassRect, ms: number) => {
      const window = win();
      if (window && !window.isDestroyed())
        addon.setDrawerGlass(window.getNativeWindowHandle(), open, r.x, r.y, r.w, r.h, r.r, ms);
    };
    const none = { x: 0, y: 0, w: 0, h: 0, r: 0 };
    const live = () => {
      const window = win();
      return window && !window.isDestroyed() ? window : undefined;
    };
    return {
      beginRegistration: () => {
        const window = live();
        if (window) addon.beginDrawerRegistration(window.getNativeWindowHandle());
      },
      endRegistration: () => {
        const window = live();
        if (window) addon.endDrawerRegistration(window.getNativeWindowHandle());
      },
      open: (rect, ms) => call(true, rect, ms),
      hide: () => {
        if (live()) addon.hideDrawerGlass();
      },
      close: (ms) => call(false, none, ms),
    };
  } catch {
    return undefined;
  }
}

/**
 * The Screen window is closing: the add-on drops its per-window state (pending glass animations, the
 * drawer's glass, the view-order keeper and its run-loop observer). A no-op without the add-on.
 */
export function disposeNativeWindow(load: () => Pick<Addon, "disposeWindow"> = loadAddon): void {
  try {
    load().disposeWindow();
  } catch {
    // no native add-on: nothing to dispose
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
