import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DrawerGlass } from "../web/quick-drawer.ts";
import type { WebKitBridge, WebKitEvent, WebKitKey, WebKitView } from "../web/webkit-bridge.ts";
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

/**
 * The native WKWebView API (native/mpv-embed). Events arrive as `(kind, a, b)`: message(name, json of
 * `{ body, frame: { isMainFrame, origin } }`, the frame being WebKit's own report), loaded(url),
 * navigated(url), failed(error). An empty `storeId` is the non-persistent data store.
 */
export interface WebKitAddon {
  webkitSupported(): boolean;
  webkitUserAgent(): string;
  webkitCreate(
    handle: Buffer,
    storeId: string,
    userAgent: string,
    callback: (kind: string, a: string, b: string) => void,
  ): number;
  webkitLoad(id: number, url: string): void;
  /**
   * Runs in the "couch" content world, once. `kind` "expression" awaits `(script)`; "body" runs it as a function
   * body. Calls back with an error message, or null and the result as `JSON.stringify([value])`.
   */
  webkitEvaluate(
    id: number,
    script: string,
    kind: "expression" | "body",
    callback: (error: string | null, json: string) => void,
  ): void;
  /** `cookiesJson` is a JSON array of `{ domain, name, path, value, secure, httpOnly, expires? }` (expires in Unix ms). Calls back with an error message, or null. */
  webkitSetCookies(id: number, cookiesJson: string, callback: (error: string | null) => void): void;
  /** What the view's store holds, as `JSON.stringify([[{ domain, name, path, secure, httpOnly, expires, sameSite }]])` (never values). For self-tests. */
  webkitListCookies(id: number, callback: (error: string | null, json: string) => void): void;
  webkitAddUserScript(id: number, source: string, world: "couch" | "page"): void;
  /** Adds the script under `slot`, or replaces the one already there; it runs at document start of later navigations. */
  webkitSetUserScript(id: number, slot: string, source: string, world: "couch" | "page"): void;
  /** The handler exists in the "couch" world only. */
  webkitAddMessageHandler(id: number, name: string): void;
  webkitSetFrame(id: number, x: number, y: number, w: number, h: number): void;
  webkitSetVisible(id: number, visible: boolean): void;
  webkitFocus(id: number): void;
  webkitSendKey(id: number, key: string, down: boolean): void;
  /** Replays a physical key (the JSON of a key event's fields, minus `swallowed`) to the view as the same NSEvent. */
  webkitReplayKey(id: number, keyJson: string): void;
  /**
   * What real input the view takes off Chromium's transparent layer: `keys` reports physical keys (kind "key", b = JSON
   * of the key) while the view is the first responder and keeps them from it; `captureCommands` also takes Command
   * combinations (except ⌘Q, ⌘H, ⌘M, ⌘W); `pointer` hands clicks, drags and the wheel over the view to it.
   */
  webkitSetInput(id: number, keys: boolean, captureCommands: boolean, pointer: boolean): void;
  webkitDestroy(id: number): void;
  /** Deletes a persistent data store; calls back with an error message, or null. */
  webkitRemoveStore(storeId: string, callback: (error: string | null) => void): void;
}

/** Sends `keys` as NSEvents to a detached WKWebView in a never-shown window on a secure origin, then runs the script; calls back with the JSON it returned. For self-tests only. */
export interface WebKitSelfTestAddon {
  webkitSelfTest(
    script: string,
    keys: string[],
    callback: (error: string | null, json: string) => void,
  ): void;
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

/**
 * Native WKWebViews in `win`, or undefined when the add-on isn't built or this macOS has no WKWebView.
 * Loading is lazy: nothing happens until a view is created.
 */
export function createWebKitBridge(
  win: () => BrowserWindow | undefined,
  load: () => WebKitAddon = () => loadAddon() as unknown as WebKitAddon,
): WebKitBridge | undefined {
  let addon: WebKitAddon;
  try {
    addon = load();
    if (!addon.webkitSupported()) return undefined;
  } catch {
    return undefined;
  }
  return {
    userAgent: () => addon.webkitUserAgent(),
    create: (options): WebKitView => {
      const window = win();
      if (!window || window.isDestroyed()) throw new Error("no window to embed into");
      const listeners = new Set<(event: WebKitEvent) => void>();
      const emit = (event: WebKitEvent) => {
        for (const l of Array.from(listeners)) l(event);
      };
      const id = addon.webkitCreate(
        window.getNativeWindowHandle(),
        options.store.ephemeral ? "" : options.store.id,
        options.userAgent,
        (kind, a, b) => {
          if (kind === "message") {
            let envelope: { body?: unknown; frame?: { isMainFrame?: unknown; origin?: unknown } };
            try {
              envelope = JSON.parse(b);
            } catch {
              return;
            }
            const frame = envelope?.frame;
            emit({
              type: "message",
              name: a,
              body: envelope?.body,
              frame: {
                isMainFrame: frame?.isMainFrame === true,
                origin: typeof frame?.origin === "string" ? frame.origin : "",
              },
            });
          } else if (kind === "key") {
            let key: Partial<WebKitKey>;
            try {
              key = JSON.parse(b);
            } catch {
              return;
            }
            emit({
              type: "key",
              key: {
                down: key.down === true,
                keyCode: Number(key.keyCode) || 0,
                characters: typeof key.characters === "string" ? key.characters : "",
                charactersIgnoringModifiers:
                  typeof key.charactersIgnoringModifiers === "string"
                    ? key.charactersIgnoringModifiers
                    : "",
                flags: Number(key.flags) || 0,
                repeat: key.repeat === true,
                swallowed: key.swallowed === true,
              },
            });
          } else if (kind === "loaded" || kind === "navigated") emit({ type: kind, url: a });
          else if (kind === "failed") emit({ type: "failed", error: a });
        },
      );
      return {
        load: (url) => addon.webkitLoad(id, url),
        evaluate: (script, { kind }) =>
          new Promise((resolve, reject) =>
            addon.webkitEvaluate(id, script, kind, (error, json) => {
              if (error !== null) return reject(new Error(error));
              try {
                resolve((JSON.parse(json) as unknown[])[0]);
              } catch (e) {
                reject(e);
              }
            }),
          ),
        setCookies: (cookies) =>
          new Promise((resolve, reject) =>
            addon.webkitSetCookies(id, JSON.stringify(cookies), (error) =>
              error === null ? resolve() : reject(new Error(error)),
            ),
          ),
        addUserScript: (source, world) => addon.webkitAddUserScript(id, source, world),
        setUserScript: (slot, source, world) => addon.webkitSetUserScript(id, slot, source, world),
        addMessageHandler: (name) => addon.webkitAddMessageHandler(id, name),
        setFrame: (x, y, w, h) => addon.webkitSetFrame(id, x, y, w, h),
        setVisible: (visible) => addon.webkitSetVisible(id, visible),
        focus: () => addon.webkitFocus(id),
        sendKey: (key, down) => addon.webkitSendKey(id, key, down),
        replayKey: (key) => addon.webkitReplayKey(id, JSON.stringify(key)),
        setInputRouting: (r) => addon.webkitSetInput(id, r.keys, r.captureCommands, r.pointer),
        onEvent: (listener) => {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
        destroy: () => addon.webkitDestroy(id),
      };
    },
    removeStore: (storeId) =>
      new Promise((resolve, reject) =>
        addon.webkitRemoveStore(storeId, (error) =>
          error === null ? resolve() : reject(new Error(error)),
        ),
      ),
  };
}

/** Runs a self-test script in a detached WKWebView; resolves to what it returned. Rejects when the add-on has no WebKit. */
export function webkitSelfTest(
  script: string,
  keys: string[] = [],
  load: () => WebKitSelfTestAddon = () => loadAddon() as unknown as WebKitSelfTestAddon,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      load().webkitSelfTest(script, keys, (error, json) => {
        if (error !== null) return reject(new Error(error));
        try {
          resolve((JSON.parse(json) as unknown[])[0]);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}
