import vm from "node:vm";

/** A media element as the sound and hidden scripts see it. */
export class FakeMedia {
  tagName: string;
  volume = 1;
  paused = false;
  constructor(tagName: "VIDEO" | "AUDIO" = "VIDEO") {
    this.tagName = tagName;
  }
  pause() {
    this.paused = true;
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
