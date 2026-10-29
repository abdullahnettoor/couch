import { PlaybackUnavailable, type AppPlayback, type PlaybackOption } from "../apps/app.ts";
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

function unavailableText(reason: string): string {
  return `WebKit unavailable: ${reason}`;
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
  /** Asked each time: the FairPlay check may still be running when Couch starts. */
  webkit: () => WebKitAvailability;
}): AppPlayback {
  return {
    options: [WEBKIT, CHROMIUM],
    current: () => (o.host.engine === "webkit" ? WEBKIT : CHROMIUM),
    get unavailable() {
      const w = o.webkit();
      return w.available ? undefined : unavailableText(w.reason);
    },
    select: async (id) => {
      if (id !== "webkit" && id !== "chromium") throw new Error(`unknown engine ${id}`);
      const w = o.webkit();
      if (id === "webkit" && !w.available) throw new PlaybackUnavailable(unavailableText(w.reason));
      // The host switches first (and throws, leaving everything as it was, when it can't); only then is the choice kept.
      o.host.switchTo(id);
      const doc = o.store.read<Record<string, unknown>>(DOC, {});
      o.store.write(DOC, { ...(doc && typeof doc === "object" ? doc : {}), [o.appId]: id });
    },
  };
}
