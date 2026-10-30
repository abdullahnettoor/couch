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

/**
 * A physical key the native side saw while the view was the window's first responder, as the NSEvent says it
 * (the host decides whether it is Couch's or the page's). `flags` is `NSEvent.modifierFlags`. `id` is above 0 when
 * the native side is holding the key back: the host must answer it (`answerKey`) within a short deadline, or the
 * key goes to the page; 0 means the key already reached the view.
 */
export interface WebKitKey {
  id: number;
  down: boolean;
  keyCode: number;
  characters: string;
  charactersIgnoringModifiers: string;
  flags: number;
  repeat: boolean;
}

/** Which real input the native side takes off Chromium's layer and gives to the view. */
export interface WebKitInputRouting {
  /** Physical keys are reported (`key` events) instead of reaching the view directly. */
  keys: boolean;
  /**
   * Couch takes every key (it captures typed text, or an overlay such as Picture off is up), Command combinations too
   * (except ⌘Q, ⌘H, ⌘M, ⌘W). Off, only Couch's own keys are held back: Escape and ⌘F with a field focused in the
   * page, and every key but Command combinations (plus ⌘F) otherwise.
   */
  captureCommands: boolean;
  /** A text field in the page has focus: typing goes straight to WebKit (so composition works). */
  fieldFocused: boolean;
  /** Clicks, drags and the wheel over the view reach it, not the transparent layer above (hover goes to both). */
  pointer: boolean;
}

/** The key names `WebKitView.sendKey` knows (the native add-on's table); a description's `keyCodes` must stay within them. */
export const WEBKIT_KEY_NAMES = ["Up", "Down", "Left", "Right", "Return", "Escape", "Space"];

/** What a native `WKWebView` reports back. */
export type WebKitEvent =
  | { type: "key"; key: WebKitKey }
  /** A `window.webkit.messageHandlers[name].postMessage(body)` from the page (body as JSON-compatible data). */
  | { type: "message"; name: string; body: unknown; frame: WebKitFrame }
  /** A main-frame load finished at this address. */
  | { type: "loaded"; url: string }
  | { type: "failed"; error: string }
  /** While the navigation guard is on: the main frame is about to go to this address (a link, a script or a redirect), and is held until the host answers `id`. */
  | { type: "navigating"; id: number; url: string }
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
  /** Absent or "none": no policy is set (WebKit's default). */
  sameSite?: "none" | "lax" | "strict";
}

/** One native `WKWebView` in the Screen window, under Chromium's compositor (native/mpv-embed). */
export interface WebKitView {
  load(url: string): void;
  /** Runs a script in the `couch` world and resolves to its value; rejects when it throws. It runs once, whatever the error. */
  evaluate(script: string, options: { kind: EvaluateKind }): Promise<unknown>;
  /** Runs at document start in every frame of every later navigation, in the given world. */
  addUserScript(source: string, world: ScriptWorld): void;
  /**
   * Like `addUserScript`, but under a name: a later call with the same slot replaces that script, so the next
   * navigation's document-start script is the latest one (the host keeps state in it, with no race against a load).
   */
  setUserScript(slot: string, source: string, world: ScriptWorld): void;
  /** Makes `window.webkit.messageHandlers[name]` exist in the `couch` world only, in every frame of later navigations. */
  addMessageHandler(name: string): void;
  /** A rectangle in window content points, top-left origin. */
  setFrame(x: number, y: number, width: number, height: number): void;
  setVisible(visible: boolean): void;
  /** Sets cookies in the view's data store (`WKHTTPCookieStore`); resolves once all are set. */
  setCookies(cookies: WebKitCookie[]): Promise<void>;
  /** Makes the view the window's first responder, so keys reach it. */
  focus(): void;
  /** Turns the navigation guard on or off. On, every main-frame navigation (redirects included) is reported as `navigating` and held until `answerNavigation` (no answer within a couple of seconds cancels it). */
  setNavigationGuard(on: boolean): void;
  /** Lets a held navigation (`navigating`'s id) go ahead or cancels it. Once per id. */
  answerNavigation(id: number, allow: boolean): void;
  /** Answers a held key (`WebKitKey.id`): `true` gives it to the view as the same NSEvent it came in as, `false` consumes it. Once per id. */
  answerKey(id: number, replay: boolean): void;
  /**
   * A real mouse-moved event at a point of the page (client coordinates), for Couch's own wake of a player's bar. The page's
   * D-pad shield doesn't take it for the household's mouse (the script that asks marks it first).
   */
  wakePointer(x: number, y: number): void;
  /** What real input the view takes. Off by default; the host sets it while the view is on screen. */
  setInputRouting(routing: WebKitInputRouting): void;
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
