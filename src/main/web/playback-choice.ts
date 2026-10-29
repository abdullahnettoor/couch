import type { AppPlayback, PlaybackOption } from "../apps/app.ts";
import type { Store } from "../ports/store.ts";
import type { Engine, WebKitAvailability } from "./native-front.ts";

const DOC = "apps-playback";

const WEBKIT: PlaybackOption = { id: "webkit", label: "WebKit (FairPlay)" };
const CHROMIUM: PlaybackOption = { id: "chromium", label: "Chromium (Widevine)" };

/** The engine the household chose for an App, if they ever did. */
export function readStoredEngine(store: Store, appId: string): Engine | undefined {
  const doc = store.read<unknown>(DOC, {});
  const mine = doc && typeof doc === "object" ? (doc as Record<string, unknown>)[appId] : undefined;
  return mine === "webkit" || mine === "chromium" ? mine : undefined;
}

export interface PlaybackHost {
  readonly engine: Engine;
  switchTo(engine: Engine): void;
}

/** Settings → Apps → Playback for one App: the choice is stored per App, then the host swaps to it. */
export function createPlayback(o: {
  store: Store;
  appId: string;
  host: PlaybackHost;
  webkit: WebKitAvailability;
}): AppPlayback {
  return {
    options: [WEBKIT, CHROMIUM],
    current: () => (o.host.engine === "webkit" ? WEBKIT : CHROMIUM),
    unavailable: o.webkit.available ? undefined : o.webkit.reason,
    select: async (id) => {
      if (id !== "webkit" && id !== "chromium") throw new Error(`unknown engine ${id}`);
      if (id === "webkit" && !o.webkit.available) throw new Error(o.webkit.reason);
      const doc = o.store.read<Record<string, unknown>>(DOC, {});
      o.store.write(DOC, { ...(doc && typeof doc === "object" ? doc : {}), [o.appId]: id });
      o.host.switchTo(id);
    },
  };
}
