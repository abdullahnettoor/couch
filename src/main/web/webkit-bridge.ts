import { createHash } from "node:crypto";

/** What a native `WKWebView` reports back. */
export type WebKitEvent =
  /** A `window.webkit.messageHandlers[name].postMessage(body)` from the page (body as JSON-compatible data). */
  | { type: "message"; name: string; body: unknown }
  /** A main-frame load finished at this address. */
  | { type: "loaded"; url: string }
  | { type: "failed"; error: string }
  /** The main frame's address changed (including pushState). */
  | { type: "navigated"; url: string };

/** One native `WKWebView` in the Screen window, under Chromium's compositor (native/mpv-embed). */
export interface WebKitView {
  load(url: string): void;
  /** Runs a script in the page and resolves to its value (a promise is awaited); rejects when the script throws. */
  evaluate(script: string): Promise<unknown>;
  /** Runs at document start in every frame of every later navigation. */
  addUserScript(source: string): void;
  /** Makes `window.webkit.messageHandlers[name]` exist in every frame of later navigations. */
  addMessageHandler(name: string): void;
  /** A rectangle in window content points, top-left origin. */
  setFrame(x: number, y: number, width: number, height: number): void;
  setVisible(visible: boolean): void;
  /** Makes the view the window's first responder, so keys reach it. */
  focus(): void;
  /** A native NSEvent keyDown or keyUp sent to the view (names as in a description's `keyCodes`: Up, Down, Left, Right, Return, Escape). */
  sendKey(key: string, down: boolean): void;
  onEvent(listener: (event: WebKitEvent) => void): () => void;
  destroy(): void;
}

export interface WebKitViewOptions {
  /** The persistent `WKWebsiteDataStore(forIdentifier:)`, one per App. */
  storeId: string;
  userAgent: string;
}

/** Creates WebKit views in the Screen window; the production one is the native add-on, tests use a fake. */
export interface WebKitBridge {
  /** Safari's user agent, built from the installed Safari. */
  userAgent(): string;
  create(options: WebKitViewOptions): WebKitView;
}

/** A stable UUID for an App's WebKit data store, so its sign-in persists across launches and stays apart from every other store. */
export function webkitStoreId(appId: string): string {
  const h = createHash("sha1").update(`couch.webkit.${appId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
