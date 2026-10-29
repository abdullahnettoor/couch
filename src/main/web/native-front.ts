/** Set on the renderer's `body` while a native (WebKit) App view is the front view: the page draws nothing of its own, so the view under it shows. */
export const NATIVE_APP_CLASS = "native-app-front";

export function nativeAppFront(
  state: { view: string; app?: string },
  nativeApps: ReadonlySet<string>,
): boolean {
  return state.view === "app" && state.app !== undefined && nativeApps.has(state.app);
}

export type Engine = "webkit" | "chromium";

/** Whether the WebKit engine can run here, and when it can't, why (in words for the row in Settings). */
export type WebKitAvailability = { available: true } | { available: false; reason: string };

/**
 * Which engine a web App starts on. WebKit (FairPlay) is the default where it is available; a stored Chromium choice is
 * honoured even then, and a stored (or default) WebKit choice falls back to Chromium with the reason when it isn't.
 * `COUCH_NETFLIX_ENGINE=webkit|chromium` is a developer override over the stored choice; normal use never sets it.
 */
export function chooseEngine(input: {
  stored: Engine | undefined;
  env: Record<string, string | undefined>;
  webkit: WebKitAvailability;
}): { engine: Engine; reason?: string } {
  const flag = input.env.COUCH_NETFLIX_ENGINE;
  const wanted: Engine =
    flag === "webkit" || flag === "chromium" ? flag : (input.stored ?? "webkit");
  if (wanted === "chromium") return { engine: "chromium" };
  return input.webkit.available
    ? { engine: "webkit" }
    : { engine: "chromium", reason: input.webkit.reason };
}
