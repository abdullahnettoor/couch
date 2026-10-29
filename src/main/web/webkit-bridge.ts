/** The frame a script message came from, as WebKit reports it (not as the page says). */
export interface WebKitFrame {
  isMainFrame: boolean;
  /** The frame's security origin: `https://host[:port]`. */
  origin: string;
}

/** `expression`: one JS expression (a promise is awaited). `body`: a statement list, run as a function body (use `return` for a value). Never guessed from the text. */
export type EvaluateKind = "expression" | "body";

/** A content world: Couch's own scripts run in `couch` (the page can't see them); `page` is Netflix's own world. */
export type ScriptWorld = "couch" | "page";

/** What a native `WKWebView` reports back. */
export type WebKitEvent =
  /** A `window.webkit.messageHandlers[name].postMessage(body)` from the page (body as JSON-compatible data). */
  | { type: "message"; name: string; body: unknown; frame: WebKitFrame }
  /** A main-frame load finished at this address. */
  | { type: "loaded"; url: string }
  | { type: "failed"; error: string }
  /** The main frame's address changed (including pushState). */
  | { type: "navigated"; url: string };

/** A cookie to put in an App's store. `expires` is Unix milliseconds; absent for a session cookie. */
export interface WebKitCookie {
  domain: string;
  name: string;
  path: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
}

/** One native `WKWebView` in the Screen window, under Chromium's compositor (native/mpv-embed). */
export interface WebKitView {
  load(url: string): void;
  /** Runs a script in the `couch` world and resolves to its value; rejects when it throws. It runs once, whatever the error. */
  evaluate(script: string, options: { kind: EvaluateKind }): Promise<unknown>;
  /** Runs at document start in every frame of every later navigation, in the given world. */
  addUserScript(source: string, world: ScriptWorld): void;
  /** Makes `window.webkit.messageHandlers[name]` exist in the `couch` world only, in every frame of later navigations. */
  addMessageHandler(name: string): void;
  /** A rectangle in window content points, top-left origin. */
  setFrame(x: number, y: number, width: number, height: number): void;
  setVisible(visible: boolean): void;
  /** Sets cookies in the view's data store (`WKHTTPCookieStore`); resolves once all are set. */
  setCookies(cookies: WebKitCookie[]): Promise<void>;
  /** Makes the view the window's first responder, so keys reach it. */
  focus(): void;
  /** A native NSEvent keyDown or keyUp sent to the view (names as in a description's `keyCodes`: Up, Down, Left, Right, Return, Escape). */
  sendKey(key: string, down: boolean): void;
  onEvent(listener: (event: WebKitEvent) => void): () => void;
  destroy(): void;
}

/** The persistent `WKWebsiteDataStore(forIdentifier:)` of one App in one userData root, or the non-persistent store. */
export type WebKitStore = { ephemeral: true } | { ephemeral: false; id: string };

export interface WebKitViewOptions {
  store: WebKitStore;
  userAgent: string;
}

/** Creates WebKit views in the Screen window; the production one is the native add-on, tests use a fake. */
export interface WebKitBridge {
  /** Safari's user agent, built from the installed Safari. */
  userAgent(): string;
  create(options: WebKitViewOptions): WebKitView;
  /** Deletes a persistent store and everything in it. Rejects when a view still uses it. */
  removeStore(id: string): Promise<void>;
}
