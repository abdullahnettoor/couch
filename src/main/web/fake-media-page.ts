import vm from "node:vm";
import { PAGE_MEDIA_FUNCTION } from "./page-media.ts";

/** A media element as the sound and hidden scripts see it. */
export class FakeMedia {
  tagName: string;
  volume = 1;
  paused = false;
  ended = false;
  constructor(tagName: "VIDEO" | "AUDIO" = "VIDEO") {
    this.tagName = tagName;
  }
  pause() {
    this.paused = true;
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
}

/** A fake page in a vm with `document`, listeners and media elements, to run page scripts on without a host. */
export function fakeMediaPage() {
  const media: FakeMedia[] = [];
  const listeners = new Map<string, Array<{ fn: (e: unknown) => void; capture: boolean }>>();
  const document = {
    addEventListener(type: string, fn: (e: unknown) => void, capture = false) {
      listeners.set(type, [...(listeners.get(type) ?? []), { fn, capture }]);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l.fn !== fn),
      );
    },
    querySelectorAll: () => media,
  };
  const sandbox: Record<string, unknown> = {
    document,
    navigator: {},
    console: { debug() {} },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  return {
    media,
    add(element: FakeMedia = new FakeMedia()) {
      media.push(element);
      return element;
    },
    run: (script: string) => vm.runInContext(script, context) as unknown,
    /** Fires a media event (it reaches capture listeners on the document, as in a page). */
    fire(type: string, target: FakeMedia) {
      for (const l of Array.from(listeners.get(type) ?? [])) l.fn({ type, target });
    },
  };
}

/** The hook script as Electron's host installs it (for tests of a page script alone, not of a host). */
export const PAGE_MEDIA_INSTALL = `(${PAGE_MEDIA_FUNCTION})()`;

/**
 * A page whose player is an element the page made and played but never put in its document. The page has only what the
 * host installed before its scripts (`installed`: a host rig's `installed()` text, or `PAGE_MEDIA_INSTALL`); a host
 * that installs no page-media hook leaves the player unseen.
 */
export function pageWithPlayerOutsideDocument(
  installed: string,
  kind: "AUDIO" | "VIDEO" = "AUDIO",
) {
  class Player extends FakeMedia {
    isConnected = false;
    readyState = 4;
    duration = 200;
    currentTime = 31.4;
    sinkId = "";
    sinkIds: string[] = [];
    #on = new Map<string, Array<(e: unknown) => void>>();
    addEventListener(type: string, fn: (e: unknown) => void) {
      this.#on.set(type, [...(this.#on.get(type) ?? []), fn]);
    }
    /** The page changes the volume itself: the element's own listeners hear volumechange (a player outside the document reaches no document's). */
    pageSetsVolume(v: number) {
      this.volume = v;
      for (const fn of this.#on.get("volumechange") ?? []) fn({ type: "volumechange", target: this });
    }
    setSinkId(id: string) {
      this.sinkId = id;
      this.sinkIds.push(id);
      return Promise.resolve();
    }
    play(): Promise<void> {
      this.paused = false;
      return Promise.resolve();
    }
  }
  const HTMLMediaElement = Player;
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const sandbox: Record<string, unknown> = {
    HTMLMediaElement,
    document: {
      querySelectorAll: () => [],
      addEventListener: (t: string, f: (e: unknown) => void) =>
        listeners.set(t, [...(listeners.get(t) ?? []), f]),
      removeEventListener: () => {},
    },
    navigator: {
      mediaSession: {
        metadata: {
          title: "Song",
          artwork: [{ src: "https://lh3.googleusercontent.com/a", sizes: "512x512" }],
        },
      },
    },
    console: { debug() {} },
    innerWidth: 1920,
    innerHeight: 1080,
    Function,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.require = () => ({
    contextBridge: { executeInMainWorld: ({ func }: { func: () => void }) => func() },
  });
  try {
    vm.runInContext(installed, context);
  } catch {}
  const player = new Player(kind);
  const run = (script: string) => vm.runInContext(script, context) as unknown;
  return {
    player,
    run,
    /** The page starts its player (through the prototype the hook wrapped). */
    start() {
      void HTMLMediaElement.prototype.play.call(player);
    },
  };
}
