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
 * `COUCH_NETFLIX_ENGINE=webkit|chromium` is a developer override over the stored choice, honoured only in an
 * unpackaged run (dev, and the real-check launcher); the installed app ignores it, so the household's choice wins.
 */
export function chooseEngine(input: {
  packaged: boolean;
  stored: Engine | undefined;
  env: Record<string, string | undefined>;
  webkit: WebKitAvailability;
}): { engine: Engine; reason?: string } {
  const wanted = wantedEngine(input);
  if (wanted === "chromium") return { engine: "chromium" };
  return input.webkit.available
    ? { engine: "webkit" }
    : { engine: "chromium", reason: input.webkit.reason };
}

/** The engine asked for before FairPlay is considered: the dev override (unpackaged only), else the stored choice, else WebKit. */
export function wantedEngine(input: {
  packaged: boolean;
  stored: Engine | undefined;
  env: Record<string, string | undefined>;
}): Engine {
  const flag = input.packaged ? undefined : input.env.COUCH_NETFLIX_ENGINE;
  return flag === "webkit" || flag === "chromium" ? flag : (input.stored ?? "webkit");
}

/**
 * What a late FairPlay answer does: when the engine the household wants (stored or default WebKit) is now usable and
 * isn't the one running, switch quietly: at once if Netflix is hidden, else the next time it is hidden.
 */
export function engineAfterProbe(o: {
  packaged: boolean;
  stored: () => Engine | undefined;
  env: Record<string, string | undefined>;
  switcher: { readonly engine: Engine; switchWhenAway(engine: Engine): boolean };
}): (answer: WebKitAvailability) => void {
  return (answer) => {
    const wanted = chooseEngine({
      packaged: o.packaged,
      stored: o.stored(),
      env: o.env,
      webkit: answer,
    }).engine;
    if (wanted !== o.switcher.engine) o.switcher.switchWhenAway(wanted);
  };
}
