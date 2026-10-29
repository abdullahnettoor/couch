/** Set on the renderer's `body` while a native (WebKit) App view is the front view: the page draws nothing of its own, so the view under it shows. */
export const NATIVE_APP_CLASS = "native-app-front";

export function nativeAppFront(
  state: { view: string; app?: string },
  nativeApps: ReadonlySet<string>,
): boolean {
  return state.view === "app" && state.app !== undefined && nativeApps.has(state.app);
}

/** WebKit (FairPlay) only behind the developer flag `COUCH_NETFLIX_ENGINE=webkit`, and only where the add-on can make views. */
export function netflixEngine(
  env: Record<string, string | undefined>,
  webkitAvailable: boolean,
): "webkit" | "chromium" {
  return env.COUCH_NETFLIX_ENGINE === "webkit" && webkitAvailable ? "webkit" : "chromium";
}
