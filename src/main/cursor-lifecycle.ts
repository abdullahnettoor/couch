export type HostEvent = "focus" | "blur" | "hide" | "show" | "quit";

/** What the Electron host tells us about Couch being in front, hidden, or quitting. */
export interface CursorHost {
  /** Read once, when wiring, for the starting state. */
  focused(): boolean;
  on(event: HostEvent, cb: () => void): void;
  /** Whether playback is on screen, on every Screen update. */
  onScreen(cb: (playing: boolean) => void): void;
}

/** What the lifecycle starts and stops: the cursor hider, or anything else that only acts while Couch is in front. */
export interface Lifecycle {
  playing(on: boolean): void;
  release(): void;
}

/**
 * The cursor hides only while playback is on screen and Couch is focused and visible. Every host
 * event updates our own state; leaving that state releases the cursor explicitly. After a quit
 * nothing can arm hiding again.
 */
export function wireCursor(host: CursorHost, cursor: Lifecycle): void {
  let playing = false;
  let focused = host.focused();
  let hidden = false;
  let quit = false;
  const sync = (): void => {
    if (playing && focused && !hidden && !quit) cursor.playing(true);
    else cursor.release();
  };
  host.on("focus", () => ((focused = true), sync()));
  host.on("blur", () => ((focused = false), sync()));
  host.on("hide", () => ((hidden = true), sync()));
  host.on("show", () => ((hidden = false), sync()));
  host.on("quit", () => ((quit = true), sync()));
  host.onScreen((on) => ((playing = on), sync()));
}

/** Things that must vanish at once, not fade, when Couch loses focus, is hidden, or quits. */
export function wireTeardown(host: Pick<CursorHost, "on">, teardown: () => void): void {
  for (const event of ["blur", "hide", "quit"] as const) host.on(event, teardown);
}
