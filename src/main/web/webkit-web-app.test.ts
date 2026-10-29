import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { netflixDescription } from "../apps/netflix/netflix-web.ts";
import type { Confirmation } from "../../shared/protocol.ts";
import type { YouTubeEvent } from "../ports/youtube.ts";
import {
  type EvaluateKind,
  type ScriptWorld,
  type WebKitBridge,
  type WebKitCookie,
  type WebKitEvent,
  type WebKitInputRouting,
  type WebKitKey,
  type WebKitFrame,
  type WebKitView,
  type WebKitStore,
  type WebKitViewOptions,
} from "./webkit-bridge.ts";
import { FakeClock } from "../ports/fakes.ts";
import { MemoryStore } from "../ports/store.ts";
import { IdleUnloader } from "./idle-unload.ts";
import { hiddenScript } from "./hidden-audio.ts";
import { fakeMediaPage } from "./fake-media-page.ts";
import { soundScript } from "./web-sound.ts";
import { noteScript, searchBarScript } from "./web-hud.ts";
import { testPageDescription } from "./webkit-test-page.ts";
import { webkitStoreId } from "./webkit-stores.ts";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import { WebKitWebApp, type WebKitHostWindow } from "./webkit-web-app.ts";
import { WEBKIT_KEY_NAMES } from "./webkit-bridge.ts";
import { CursorHider } from "../cursor-hider.ts";
import { MouseMoves } from "../mouse-moves.ts";

class FakeView implements WebKitView {
  options: WebKitViewOptions;
  loads: string[] = [];
  scripts: string[] = [];
  worlds: ScriptWorld[] = [];
  kinds: EvaluateKind[] = [];
  handlers: string[] = [];
  frames: Array<[number, number, number, number]> = [];
  visible: boolean[] = [];
  keys: Array<[string, boolean]> = [];
  evaluated: string[] = [];
  focused = 0;
  destroyed = false;
  cookies: WebKitCookie[] = [];
  listeners = new Set<(e: WebKitEvent) => void>();
  /** Answers to `evaluate`, by a substring of the script. */
  answers: Array<[string, unknown]> = [];
  /** The order things were done in. */
  log: string[] = [];
  constructor(options: WebKitViewOptions) {
    this.options = options;
  }
  load(url: string) {
    this.log.push("load");
    this.loads.push(url);
  }
  async evaluate(script: string, options: { kind: EvaluateKind }) {
    this.evaluated.push(script);
    this.kinds.push(options.kind);
    for (const [part, answer] of this.answers) if (script.includes(part)) return answer;
    return undefined;
  }
  addUserScript(source: string, world: ScriptWorld) {
    this.log.push("script");
    this.scripts.push(source);
    this.worlds.push(world);
  }
  /** The latest script of each named slot (what the next document starts with), and its world. */
  slots = new Map<string, { source: string; world: ScriptWorld }>();
  setUserScript(slot: string, source: string, world: ScriptWorld) {
    this.log.push("slot");
    this.slots.set(slot, { source, world });
  }
  addMessageHandler(name: string) {
    this.handlers.push(name);
  }
  setFrame(x: number, y: number, w: number, h: number) {
    this.frames.push([x, y, w, h]);
  }
  setVisible(v: boolean) {
    this.visible.push(v);
  }
  focus() {
    this.focused++;
  }
  async setCookies(cookies: WebKitCookie[]) {
    this.log.push("cookies");
    this.cookies.push(...cookies);
  }
  sendKey(key: string, down: boolean) {
    this.keys.push([key, down]);
  }
  /** Every key the native side held back, by id, and what the host answered for each (once per id, or it is a bug). */
  held = new Map<number, WebKitKey>();
  keyAnswers: Array<[number, boolean]> = [];
  answerKey(id: number, replay: boolean) {
    this.keyAnswers.push([id, replay]);
  }
  get replayed(): WebKitKey[] {
    return this.keyAnswers.filter(([, replay]) => replay).map(([id]) => this.held.get(id)!);
  }
  wakes: Array<[number, number]> = [];
  wakePointer(x: number, y: number) {
    this.wakes.push([x, y]);
  }
  routing: WebKitInputRouting[] = [];
  setInputRouting(routing: WebKitInputRouting) {
    this.routing.push(routing);
  }
  onEvent(l: (e: WebKitEvent) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  destroy() {
    this.destroyed = true;
  }
  emit(e: WebKitEvent) {
    if (e.type === "key" && e.key.id > 0) this.held.set(e.key.id, e.key);
    for (const l of Array.from(this.listeners)) l(e);
  }
}

const views: FakeView[] = [];
const bridge: WebKitBridge = {
  userAgent: () => "Mozilla/5.0 Safari-UA",
  create(options) {
    const v = new FakeView(options);
    views.push(v);
    return v;
  },
  async removeStore(id: string) {
    removed.push([id, views.at(-1)?.destroyed ?? true]);
  },
};
const removed: Array<[string, boolean]> = [];

let resize: () => void = () => {};
const win: WebKitHostWindow = {
  getContentBounds: () => ({ width: 1280, height: 720 }),
  onResize: (cb) => {
    resize = cb;
  },
  reveal: async () => {},
};

const netflix = netflixDescription("130.0.0.0");
let events: YouTubeEvent[];

const STORE = { ephemeral: false, id: webkitStoreId("test-namespace", "netflix") } as const;
const MAIN = { isMainFrame: true, origin: "https://www.netflix.com" };

function make(store: WebKitStore = STORE): { web: WebKitWebApp; view: () => FakeView } {
  const web = new WebKitWebApp(netflix, bridge, win, store);
  events = [];
  web.onEvent((e) => events.push(e));
  return { web, view: () => views.at(-1)! };
}

beforeEach(() => {
  views.length = 0;
  removed.length = 0;
});

describe("showing and hiding", () => {
  test("makes no view and no request until it is shown", () => {
    make();
    expect(views).toEqual([]);
  });

  test("shows a view with Safari's identity and the App's own store, filling the window", async () => {
    const { web, view } = make();
    web.show();
    expect(view().options).toEqual({ store: STORE, userAgent: "Mozilla/5.0 Safari-UA" });
    expect(view().frames.at(-1)).toEqual([0, 0, 1280, 720]);
    expect(view().visible.at(-1)).toBe(true);
    await vi.waitFor(() => expect(view().focused).toBeGreaterThan(0));
  });

  test("under COUCH_WEBKIT_EPHEMERAL the view gets the non-persistent store", () => {
    const { web, view } = make({ ephemeral: true });
    web.show();
    expect(view().options.store).toEqual({ ephemeral: true });
  });

  test("follows the window's size while shown", () => {
    const { web, view } = make();
    web.show();
    const before = view().frames.length;
    resize();
    expect(view().frames.length).toBe(before + 1);
  });

  test("hide hides the view, pauses its media and reports no playback", async () => {
    const { web, view } = make();
    web.show();
    web.hide();
    expect(view().visible.at(-1)).toBe(false);
    expect(view().evaluated.at(-1)).toContain("pause()");
  });

  test("shown again it reuses the view and the page", () => {
    const { web, view } = make();
    web.show();
    web.hide();
    web.show();
    expect(views).toHaveLength(1);
    expect(view().loads).toHaveLength(1);
    expect(view().visible.at(-1)).toBe(true);
  });

  test("unload drops the view; the next show loads again and reports home", () => {
    const { web } = make();
    web.show();
    web.hide();
    web.unload();
    expect(views[0]!.destroyed).toBe(true);
    expect(events.at(-1)).toEqual({ type: "route", home: true });
    web.show();
    expect(views).toHaveLength(2);
    expect(views[1]!.loads).toEqual([netflix.url]);
  });

  test("unload does nothing while shown", () => {
    const { web } = make();
    web.show();
    web.unload();
    expect(views[0]!.destroyed).toBe(false);
  });
});

describe("loading", () => {
  test("registers its scripts before it loads Netflix's URL", () => {
    const { web, view } = make();
    web.show();
    expect(view().loads).toEqual([netflix.url]);
    expect(view().log.indexOf("load")).toBeGreaterThan(view().log.lastIndexOf("script"));
    expect(view().handlers).toContain("couch");
  });

  test("the description's preloads, the hooks and the focus layer run at document start", () => {
    const { web, view } = make();
    web.show();
    const all = view().scripts.join("\n");
    expect(all).toContain(PAGE_HOOKS_FUNCTION);
    for (const p of netflix.preloads) expect(all).toContain(p.func);
    expect(all).toContain("__couchRawKeys");
  });

  test("each preload runs alone so one that throws cannot stop the rest", () => {
    const { web, view } = make();
    web.show();
    const all = view().scripts.join("\n");
    expect(all).toMatch(/try \{ \(function/);
  });

  test("reports loaded when the page finishes loading over https", () => {
    const { web, view } = make();
    web.show();
    view().emit({ type: "loaded", url: "https://www.netflix.com/browse" });
    expect(events).toContainEqual({ type: "loaded" });
  });

  test("a failed main-frame load is reported", () => {
    const { web, view } = make();
    web.show();
    view().emit({ type: "failed", error: "offline" });
    expect(events).toContainEqual({ type: "failed" });
  });

  test("restart loads the home page again", () => {
    const { web, view } = make();
    web.show();
    web.restart();
    expect(view().loads).toEqual([netflix.url, netflix.url]);
  });
});

describe("route", () => {
  test("a page's route message becomes the route event", () => {
    const { web, view } = make();
    web.show();
    view().emit({
      type: "message",
      name: "couch",
      frame: MAIN,
      body: {
        type: "route",
        url: "https://www.netflix.com/watch/80018499",
        page: { y: 0, modal: false },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "route", home: false, url: expect.any(String) }),
    );
  });

  test("the address alone (a navigation) is enough to update the route", () => {
    const { web, view } = make();
    web.show();
    view().emit({ type: "navigated", url: "https://www.netflix.com/browse" });
    expect(events).toContainEqual(expect.objectContaining({ type: "route", home: true }));
  });

  test("the route reporter script is registered and carries the App's own route script", () => {
    const { web, view } = make();
    web.show();
    const all = view().scripts.join("\n");
    expect(all).toContain(netflix.route.script);
    expect(all).toContain("messageHandlers.couch");
  });

  test("a message from another handler is ignored", () => {
    const { web, view } = make();
    web.show();
    events.length = 0;
    view().emit({
      type: "message",
      name: "other",
      frame: MAIN,
      body: { type: "route", url: "https://www.netflix.com/watch/1", page: {} },
    });
    expect(events).toEqual([]);
  });
});

describe("keys", () => {
  test("OK, Back and the arrows are sent as native key presses", async () => {
    const { web, view } = make();
    web.show();
    web.sendKey("ok");
    web.sendKey("left");
    web.sendKey("right");
    web.sendKey("up");
    web.sendKey("down");
    expect(view().keys).toEqual([
      ["Return", true],
      ["Return", false],
      ["Left", true],
      ["Left", false],
      ["Right", true],
      ["Right", false],
      ["Up", true],
      ["Up", false],
      ["Down", true],
      ["Down", false],
    ]);
  });

  test("Back with nothing open goes back in the page's history", async () => {
    const { web, view } = make();
    web.show();
    web.sendKey("back");
    await vi.waitFor(() => expect(view().evaluated.at(-1)).toBe("history.back()"));
    expect(view().keys).toEqual([]);
  });

  test("Back with a pop-up open presses Escape", async () => {
    const { web, view } = make();
    web.show();
    view().answers.push(["__couchPlayerBack", "escape"]);
    web.sendKey("back");
    await vi.waitFor(() =>
      expect(view().keys).toEqual([
        ["Escape", true],
        ["Escape", false],
      ]),
    );
  });

  test("Back the page handled itself does nothing more, and says so", async () => {
    const { web, view } = make();
    web.show();
    view().answers.push(["__couchPlayerBack", "handled"]);
    web.sendKey("back");
    await vi.waitFor(() => expect(events).toContainEqual({ type: "backHandled" }));
    expect(view().keys).toEqual([]);
  });
});

describe("playback", () => {
  const playing = { position: 12, duration: 3000, paused: false, title: "Test Pattern" };

  test("reports what the page's probe finds while shown", async () => {
    vi.useFakeTimers();
    try {
      const { web, view } = make();
      web.show();
      view().answers.push(['querySelectorAll("video")', playing]);
      await vi.advanceTimersByTimeAsync(500);
      expect(events).toContainEqual({
        type: "playback",
        playback: expect.objectContaining({ position: 12, paused: false, title: "Test Pattern" }),
      });
      expect(view().evaluated.some((s) => s.includes("/^\\/watch\\//"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("no report once hidden", async () => {
    vi.useFakeTimers();
    try {
      const { web, view } = make();
      web.show();
      view().answers.push(['querySelectorAll("video")', playing]);
      await vi.advanceTimersByTimeAsync(500);
      web.hide();
      expect(events.at(-1)).toEqual({ type: "playback", playback: undefined });
      const n = view().evaluated.length;
      await vi.advanceTimersByTimeAsync(2000);
      expect(
        view()
          .evaluated.slice(n)
          .some((s) => s.includes('querySelectorAll("video")')),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a probe that fails reports nothing playing", async () => {
    vi.useFakeTimers();
    try {
      const { web, view } = make();
      web.show();
      view().evaluate = async () => {
        throw new Error("boom");
      };
      await vi.advanceTimersByTimeAsync(500);
      expect(events.filter((e) => e.type === "playback")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("play/pause goes through the App's own control", async () => {
    const { web, view } = make();
    web.show();
    web.playPause();
    expect(view().evaluated.at(-1)).toContain("control-play-pause");
  });

  test("seeking goes through the App's adapter", () => {
    const { web, view } = make();
    web.show();
    web.seekTo(90);
    expect(view().evaluated.at(-1)).toContain("timeline");
  });
});

describe("worlds and evaluation modes", () => {
  test("the page hooks and the App's own preloads run in the page world; Couch's own scripts in the couch world", () => {
    const { web, view } = make();
    web.show();
    const inWorld = (world: ScriptWorld) =>
      view()
        .scripts.filter((_, i) => view().worlds[i] === world)
        .join("\n");
    expect(inWorld("page")).toContain(PAGE_HOOKS_FUNCTION);
    for (const p of netflix.preloads) expect(inWorld("page")).toContain(p.func);
    expect(inWorld("page")).not.toContain("messageHandlers");
    expect(inWorld("page")).not.toContain("__couchRawKeys");
    expect(inWorld("couch")).toContain("__couchRawKeys");
    expect(inWorld("couch")).toContain("messageHandlers.couch");
    expect(inWorld("couch")).not.toContain(PAGE_HOOKS_FUNCTION);
  });

  test("every script the host evaluates is an expression, and says so", async () => {
    vi.useFakeTimers();
    try {
      const { web, view } = make();
      web.show();
      web.hide();
      web.show();
      web.setVolume(40);
      web.playPause();
      web.seekTo(30);
      web.setSpeed(1.5);
      web.setTrack("audio", "a");
      web.pressPrompt("skipIntro");
      web.scrollToTop();
      web.showSearchBar("abc");
      web.showSearchBar(undefined);
      web.sendKey("back");
      web.submitSearch("x");
      web.seekBy(10);
      await vi.advanceTimersByTimeAsync(3000);
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      expect(view().evaluated.length).toBeGreaterThan(8);
      for (const script of view().evaluated)
        expect(() => new AsyncFunction(`return await (${script}\n);`), script).not.toThrow();
      expect(new Set(view().kinds)).toEqual(new Set(["expression"]));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("messages from the page are untrusted", () => {
  const route = {
    type: "route",
    url: "https://www.netflix.com/watch/80018499",
    page: { y: 0, modal: false },
  };
  const send = (view: FakeView, body: unknown, frame: WebKitFrame = MAIN, name = "couch") =>
    view.emit({ type: "message", name, body, frame });

  test("a message from the main frame at Netflix's origin is accepted", () => {
    const { web, view } = make();
    web.show();
    events.length = 0;
    send(view(), route);
    expect(events).toContainEqual(expect.objectContaining({ type: "route", home: false }));
  });

  test.each([
    ["a sub-frame of Netflix", { isMainFrame: false, origin: "https://www.netflix.com" }],
    ["a cross-origin iframe", { isMainFrame: false, origin: "https://ads.evil.example" }],
    ["another origin's main frame", { isMainFrame: true, origin: "https://evil.example" }],
    ["a look-alike host", { isMainFrame: true, origin: "https://www.netflix.com.evil.example" }],
    ["an insecure origin", { isMainFrame: true, origin: "http://www.netflix.com" }],
    ["an unknown origin", { isMainFrame: true, origin: "" }],
  ])("%s is dropped", (_name, frame) => {
    const { web, view } = make();
    web.show();
    events.length = 0;
    send(view(), route, frame);
    web.showConfirm({ title: "Leave?", buttons: ["Leave", "Stay"], focus: 0 });
    send(view(), { type: "console", message: "couch:confirm:0" }, frame);
    expect(events).toEqual([]);
  });

  test.each([
    ["not an object", "route"],
    ["null", null],
    ["an unknown type", { type: "eval", url: route.url }],
    ["a route without an address", { type: "route", page: {} }],
    ["a route whose address is not a string", { type: "route", url: 5, page: {} }],
    ["a route to a non-https address", { type: "route", url: "javascript:alert(1)", page: {} }],
    ["a route with a huge address", { type: "route", url: `https://x/${"a".repeat(9000)}` }],
    ["a route with a nested page", { type: "route", url: route.url, page: { a: { b: 1 } } }],
    ["a route with an array page", { type: "route", url: route.url, page: [1] }],
    ["a route with extra fields", { ...route, extra: true }],
    ["a console message that is not Couch's", { type: "console", message: "hello" }],
    ["a console message that is not a string", { type: "console", message: 1 }],
  ])("a malformed message (%s) is dropped", (_name, body) => {
    const { web, view } = make();
    web.show();
    web.showConfirm({ title: "Leave?", buttons: ["Leave", "Stay"], focus: 0 });
    events.length = 0;
    send(view(), body);
    expect(events).toEqual([]);
  });

  describe("confirmation answers", () => {
    const confirm: Confirmation = { title: "Leave?", buttons: ["Leave", "Stay"], focus: 0 };
    const click = (n: unknown) => ({ type: "console", message: `couch:confirm:${String(n)}` });

    test("are ignored while no prompt is open", () => {
      const { web, view } = make();
      web.show();
      events.length = 0;
      send(view(), click(0));
      send(view(), click(1));
      expect(events).toEqual([]);
    });

    test("an in-range answer is accepted while a prompt is open", () => {
      const { web, view } = make();
      web.show();
      web.showConfirm(confirm);
      send(view(), click(1));
      send(view(), { type: "console", message: "couch:confirm-hover:0" });
      expect(events).toEqual([
        { type: "confirm", index: 1, answer: true },
        { type: "confirm", index: 0, answer: false },
      ]);
    });

    test.each([2, 7, -1, 1.5, "NaN", "01x"])("an answer with index %s is rejected", (n) => {
      const { web, view } = make();
      web.show();
      web.showConfirm(confirm);
      send(view(), click(n));
      send(view(), { type: "console", message: `couch:confirm-hover:${n}` });
      expect(events).toEqual([]);
    });

    test("are ignored again once the prompt is closed", () => {
      const { web, view } = make();
      web.show();
      web.showConfirm(confirm);
      web.showConfirm(undefined);
      send(view(), click(0));
      expect(events).toEqual([]);
    });

    test("a prompt left open when the App hides does not stay open", () => {
      const { web, view } = make();
      web.show();
      web.showConfirm(confirm);
      web.hide();
      send(view(), click(0));
      expect(events.filter((e) => e.type === "confirm")).toEqual([]);
    });
  });
});

describe("sign-in", () => {
  const cookie: WebKitCookie = {
    domain: ".netflix.com",
    name: "n",
    path: "/",
    value: "fake",
    secure: true,
    httpOnly: false,
  };

  test("cookies go into the App's own view, before the page is loaded again", async () => {
    const { web, view } = make();
    await web.setCookies([cookie]);
    expect(view().cookies).toEqual([cookie]);
    expect(view().log.indexOf("cookies")).toBeLessThan(view().log.lastIndexOf("load"));
  });

  test("cookies set on a view that is already loaded reload it", async () => {
    const { web, view } = make();
    web.start();
    const loads = view().loads.length;
    await web.setCookies([cookie]);
    expect(view().loads.length).toBe(loads + 1);
  });

  test("sign out destroys the view first, then removes the App's store, and loads a fresh view", async () => {
    const { web } = make();
    web.start();
    await web.signOut();
    expect(removed).toEqual([[STORE.id, true]]);
    expect(views).toHaveLength(2);
    expect(views[0]!.destroyed).toBe(true);
    expect(views[1]!.destroyed).toBe(false);
    expect(views[1]!.loads).toEqual([netflix.url]);
  });

  test("the reload has happened before sign out resolves, after the store is gone", async () => {
    const order: string[] = [];
    const slow: WebKitBridge = {
      ...bridge,
      create: (o) => (order.push("create"), bridge.create(o)),
      removeStore: async (id) => {
        order.push("remove");
        await Promise.resolve();
        order.push("removed");
        return bridge.removeStore(id);
      },
    };
    const web = new WebKitWebApp(netflix, slow, win, STORE);
    web.start();
    order.length = 0;
    await web.signOut();
    order.push("resolved");
    expect(order).toEqual(["remove", "removed", "create", "resolved"]);
    expect(views.at(-1)!.loads).toEqual([netflix.url]);
  });

  test("a view that was shown comes back shown, and one that was hidden stays hidden", async () => {
    const shown = make();
    shown.web.show();
    await shown.web.signOut();
    expect(shown.view().visible.at(-1)).toBe(true);
    expect(shown.view().loads).toEqual([netflix.url]);

    views.length = 0;
    const hidden = make();
    hidden.web.start();
    await hidden.web.signOut();
    expect(hidden.view().visible.at(-1)).toBe(false);
  });

  test("signing out an App that never loaded loads nothing", async () => {
    const { web } = make();
    await web.signOut();
    expect(views).toHaveLength(0);
  });

  test("sign out under the ephemeral store removes nothing and still drops the view", async () => {
    const { web } = make({ ephemeral: true });
    web.start();
    await web.signOut();
    expect(removed).toEqual([]);
    expect(views[0]!.destroyed).toBe(true);
  });

  test("sign out while the App is on screen hides it first", async () => {
    const { web } = make();
    web.show();
    await web.signOut();
    expect(views[0]!.destroyed).toBe(true);
    expect(removed).toEqual([[STORE.id, true]]);
  });
});

describe("sound", () => {
  const loaded = (v: FakeView) => v.emit({ type: "loaded", url: "https://www.netflix.com/browse" });
  /** A new document: the page that the host's document-start sound script runs in. */
  const newDocument = (v: FakeView) => {
    const page = fakeMediaPage();
    page.run(v.slots.get("sound")!.source);
    return page;
  };

  test("while hidden the page's media is at volume 0, and shown again it is back at Couch's", () => {
    const { web, view } = make();
    web.show();
    web.setVolume(40);
    web.hide();
    expect(
      view()
        .evaluated.filter((s) => s.includes("__couchSound"))
        .at(-1),
    ).toBe(soundScript(0, "", false));
    web.setVolume(70);
    expect(
      view()
        .evaluated.filter((s) => s.includes("__couchSound"))
        .at(-1),
    ).toBe(soundScript(0, "", false));
    web.show();
    expect(
      view()
        .evaluated.filter((s) => s.includes("__couchSound"))
        .at(-1),
    ).toBe(soundScript(70, "", false));
  });

  test("a page that finishes loading while hidden is paused and silent", () => {
    const { web, view } = make();
    web.show();
    web.setVolume(40);
    web.hide();
    view().evaluated.length = 0;
    loaded(view());
    expect(view().evaluated).toContain(hiddenScript(true));
    expect(view().evaluated).toContain(soundScript(0, "", false));
  });

  test("a page that finishes loading shown gets the current volume and no hidden guard", () => {
    const { web, view } = make();
    web.show();
    web.setVolume(25);
    view().evaluated.length = 0;
    loaded(view());
    expect(view().evaluated).toContain(soundScript(25, "", false));
    expect(view().evaluated).not.toContain(hiddenScript(true));
  });

  test("the output follows the Mac: asking for a device is accepted quietly and says so", async () => {
    const { web } = make();
    expect(web.followsMacOutput).toBe(true);
    expect(await web.setOutputDevice("L27h-4A")).toBe(true);
    expect(await web.setOutputDevice(undefined)).toBe(true);
    expect(events.filter((e) => e.type === "output")).toEqual([]);
  });

  describe("at document start", () => {
    test("the sound script is registered in Couch's world before the first load, hidden", () => {
      const { web, view } = make();
      web.start();
      expect(view().log.indexOf("slot")).toBeGreaterThanOrEqual(0);
      expect(view().log.indexOf("slot")).toBeLessThan(view().log.indexOf("load"));
      expect(view().slots.get("sound")!.world).toBe("couch");
    });

    test("a play before the load event is paused and silent in a hidden App", () => {
      const { web, view } = make();
      web.start();
      const page = newDocument(view());
      const media = page.add();
      page.fire("play", media);
      expect(media.paused).toBe(true);
      expect(media.volume).toBe(0);
    });

    test("a first show gives the new document Couch's volume from its first frame", () => {
      const { web, view } = make();
      web.setVolume(40);
      web.show();
      const page = newDocument(view());
      const media = page.add();
      page.fire("loadstart", media);
      expect(media.volume).toBeCloseTo(0.4);
      page.fire("play", media);
      expect(media.paused).toBe(false);
    });

    test("every state change updates what the next document starts with", () => {
      const { web, view } = make();
      web.show();
      web.setVolume(70);
      let page = newDocument(view());
      let media = page.add();
      page.fire("play", media);
      expect(media.volume).toBeCloseTo(0.7);
      expect(media.paused).toBe(false);
      web.hide();
      page = newDocument(view());
      media = page.add();
      page.fire("play", media);
      expect(media.volume).toBe(0);
      expect(media.paused).toBe(true);
      web.setVolume(10);
      web.show();
      page = newDocument(view());
      media = page.add();
      page.fire("play", media);
      expect(media.volume).toBeCloseTo(0.1);
      expect(media.paused).toBe(false);
    });
  });
});

describe("idle unload", () => {
  test("the unloader destroys the hidden view and the next show makes a new one that loads", async () => {
    const clock = new FakeClock();
    const unloader = new IdleUnloader(clock, new MemoryStore());
    let web!: WebKitWebApp;
    const lifecycle = unloader.track("netflix", () => web.unload());
    const youtube = unloader.track("youtube", () => {}, { loaded: true });
    web = new WebKitWebApp(netflix, bridge, win, STORE, lifecycle);
    web.show();
    web.hide();
    youtube.shown();
    youtube.hidden();
    clock.advance(11 * 60_000);
    expect(views[0]!.destroyed).toBe(true);
    web.show();
    expect(views).toHaveLength(2);
    expect(views[1]!.loads).toEqual([netflix.url]);
  });
});

describe("Couch's screen over the view (ticket 111)", () => {
  const confirm: Confirmation = {
    title: "Leave Netflix?",
    buttons: ["Go to Home", "Stay"],
    focus: 0,
  };
  /** Nothing Couch draws may hide, pause, resize or reload the page. */
  const untouched = (view: FakeView, hiddenBefore: number, scriptsBefore: number) => {
    expect(view.visible.at(-1)).toBe(true);
    expect(view.visible.slice(hiddenBefore)).toEqual([]);
    expect(view.evaluated.slice(scriptsBefore).some((s) => s.includes("pause()"))).toBe(false);
    expect(view.loads).toHaveLength(1);
    expect(view.destroyed).toBe(false);
  };

  test("the volume display and the question are drawn by Couch's own screen, not injected into the page", () => {
    const { web, view } = make();
    web.show();
    const visible = view().visible.length;
    const before = view().evaluated.length;
    web.showVolume(40);
    web.showConfirm(confirm);
    web.showConfirm({ ...confirm, focus: 1 });
    web.showConfirm(undefined);
    web.showVolume(undefined);
    expect(view().evaluated.length).toBe(before);
    untouched(view(), visible, before);
  });

  test("the floating search bar is drawn in the page and removed again, and the page keeps playing", () => {
    const { web, view } = make();
    web.show();
    const visible = view().visible.length;
    const before = view().evaluated.length;
    web.showSearchBar("");
    web.showSearchBar("dark");
    web.showSearchBar(undefined);
    const bars = view().evaluated.filter((s) => s.includes("couch-search"));
    expect(bars).toEqual([
      searchBarScript("", netflix.search!.placeholder),
      searchBarScript("dark", netflix.search!.placeholder),
      searchBarScript(undefined, netflix.search!.placeholder),
    ]);
    expect(view().kinds.slice(-3)).toEqual(["expression", "expression", "expression"]);
    untouched(view(), visible, before);
  });

  test("the first-show note is drawn in the page once it has loaded", () => {
    const { web, view } = make();
    web.show("Press Home on your phone to come back");
    expect(view().evaluated.some((s) => s.includes("couch-note"))).toBe(false);
    view().emit({ type: "loaded", url: "https://www.netflix.com/browse" });
    expect(
      view().evaluated.filter((s) => s === noteScript("Press Home on your phone to come back")),
    ).toHaveLength(1);
    view().emit({ type: "loaded", url: "https://www.netflix.com/browse" });
    expect(view().evaluated.filter((s) => s.includes("couch-note"))).toHaveLength(1);
  });

  test("a note on a page that is already loaded is drawn at once", () => {
    const { web, view } = make();
    web.show();
    view().emit({ type: "loaded", url: "https://www.netflix.com/browse" });
    web.hide();
    web.show("Press Home on your phone to come back");
    expect(view().evaluated.some((s) => s.includes("couch-note"))).toBe(true);
  });

  test("the App error screen: a failed load is reported, and a restart loads the page again without a new view", () => {
    const { web, view } = make();
    web.show();
    view().emit({ type: "failed", error: "offline" });
    expect(events).toContainEqual({ type: "failed" });
    web.hide();
    expect(view().visible.at(-1)).toBe(false);
    web.restart();
    web.show();
    expect(views).toHaveLength(1);
    expect(view().loads).toEqual([netflix.url, netflix.url]);
    expect(view().visible.at(-1)).toBe(true);
    // The page that comes back is reported as loaded again, so the error screen clears.
    view().emit({ type: "loaded", url: "https://www.netflix.com/browse" });
    expect(events.at(-1)).toEqual({ type: "loaded" });
  });

  test("a failed load after the error is not turned into loaded by a stale finish", () => {
    const { web, view } = make();
    web.show();
    view().emit({ type: "failed", error: "offline" });
    events.length = 0;
    view().emit({ type: "loaded", url: "https://www.netflix.com/browse" });
    expect(events).toEqual([]);
  });
});

describe("the dev test page (ticket 111)", () => {
  const origin = "http://127.0.0.1:5555";
  const page = testPageDescription(netflix, origin);
  const makeTest = () => {
    const web = new WebKitWebApp(page, bridge, win, { ephemeral: true });
    events = [];
    web.onEvent((e) => events.push(e));
    return web;
  };

  test("it loads the test page, and its own origin's load counts as loaded", () => {
    const web = makeTest();
    web.show();
    expect(views.at(-1)!.loads).toEqual([`${origin}/watch/1`]);
    views.at(-1)!.emit({ type: "loaded", url: `${origin}/watch/1` });
    expect(events).toContainEqual({ type: "loaded" });
  });

  test("a load of any other plain http address still does not count", () => {
    const web = makeTest();
    web.show();
    views.at(-1)!.emit({ type: "loaded", url: "http://example.com/" });
    expect(events).not.toContainEqual({ type: "loaded" });
  });

  test("Netflix's own host still refuses plain http", () => {
    const { web, view } = make();
    web.show();
    view().emit({ type: "loaded", url: `${origin}/watch/1` });
    expect(events).not.toContainEqual({ type: "loaded" });
  });
});

describe("input", () => {
  const OFF = { keys: false, captureCommands: false, fieldFocused: false, pointer: false };
  const ON = { keys: true, captureCommands: false, fieldFocused: false, pointer: true };
  let nextId = 1;
  const key = (over: Partial<WebKitKey>): WebKitKey => ({
    id: nextId++,
    down: true,
    keyCode: 0,
    characters: "a",
    charactersIgnoringModifiers: "a",
    flags: 0,
    repeat: false,
    ...over,
  });
  const press = (view: FakeView, k: WebKitKey) => view.emit({ type: "key", key: k });
  const field = (view: FakeView, message: string, frame: WebKitFrame = MAIN) =>
    view.emit({ type: "message", name: "couch", body: { type: "console", message }, frame });
  const ARROW_UP = { keyCode: 126, characters: "\uF700", flags: (1 << 21) | (1 << 23) };

  test("on screen, the view takes the keys and the pointer; hidden, nothing", () => {
    const { web, view } = make();
    web.show();
    expect(view().routing.at(-1)).toEqual(ON);
    web.hide();
    expect(view().routing.at(-1)).toEqual(OFF);
  });

  test("a view started hidden takes no input", () => {
    const { web, view } = make();
    web.start();
    expect(view().routing.at(-1) ?? OFF).toEqual(OFF);
  });

  describe("the Mac keyboard", () => {
    test("Couch's keys go to the core and don't reach the page", () => {
      const { web, view } = make();
      web.show();
      press(view(), key(ARROW_UP));
      press(view(), key({ keyCode: 36, characters: "\r" }));
      expect(events.filter((e) => e.type === "key")).toEqual([
        { type: "key", command: "up" },
        { type: "key", command: "ok" },
      ]);
      expect(view().replayed).toEqual([]);
    });

    test("other keys go to the page as the native key they were", () => {
      const { web, view } = make();
      web.show();
      press(view(), key({ keyCode: 6, characters: "z", charactersIgnoringModifiers: "z" }));
      expect(view().replayed).toHaveLength(1);
      expect(view().replayed[0]).toMatchObject({ keyCode: 6, characters: "z", down: true });
      expect(events).toContainEqual({ type: "input" });
    });

    test("typing in a field of the page: every key is the page's, until the field blurs", () => {
      const { web, view } = make();
      web.show();
      field(view(), "couch:field-focused");
      press(view(), key({ keyCode: 4, characters: "h" }));
      press(view(), key({ keyCode: 49, characters: " " }));
      expect(view().replayed).toHaveLength(2);
      expect(events.filter((e) => e.type === "key")).toEqual([]);
      field(view(), "couch:field-blurred");
      press(view(), key({ keyCode: 4, characters: "h" }));
      expect(events).toContainEqual({ type: "key", command: "home" });
    });

    test("a field focus from a sub-frame or a foreign origin does not claim the keyboard", () => {
      const { web, view } = make();
      web.show();
      field(view(), "couch:field-focused", {
        isMainFrame: false,
        origin: "https://www.netflix.com",
      });
      field(view(), "couch:field-focused", { isMainFrame: true, origin: "https://evil.example" });
      press(view(), key({ keyCode: 4, characters: "h" }));
      expect(events).toContainEqual({ type: "key", command: "home" });
    });

    test("a new page forgets the field's focus", () => {
      const { web, view } = make();
      web.show();
      field(view(), "couch:field-focused");
      view().emit({ type: "navigated", url: "https://www.netflix.com/browse" });
      press(view(), key({ keyCode: 4, characters: "h" }));
      expect(events).toContainEqual({ type: "key", command: "home" });
    });

    test("while Couch captures typed text, the page gets nothing and Command keys are taken too", () => {
      const { web, view } = make();
      web.show();
      web.captureText(true);
      expect(view().routing.at(-1)).toEqual({ ...ON, captureCommands: true });
      press(view(), key({ keyCode: 12, characters: "q", charactersIgnoringModifiers: "q" }));
      expect(events).toContainEqual({ type: "edit", edit: { insert: "q" } });
      expect(view().replayed).toEqual([]);
      web.captureText(false);
      expect(view().routing.at(-1)).toEqual(ON);
    });

    test("the key gate goes first (Picture off swallows every key)", () => {
      const { web, view } = make();
      const seen: string[] = [];
      web.setKeyGate((_e, input) => {
        seen.push(`${input.type}:${input.key}`);
        return true;
      });
      web.show();
      events.length = 0;
      press(view(), key(ARROW_UP));
      press(view(), key({ keyCode: 6, characters: "z" }));
      expect(seen).toEqual(["keyDown:ArrowUp", "keyDown:z"]);
      expect(events).toEqual([]);
      expect(view().replayed).toEqual([]);
    });

    test("keys that arrive after hide are ignored", () => {
      const { web, view } = make();
      web.show();
      web.hide();
      events.length = 0;
      press(view(), key({ keyCode: 6, characters: "z" }));
      press(view(), key(ARROW_UP));
      expect(view().replayed).toEqual([]);
      expect(events).toEqual([]);
    });
  });

  describe("held keys", () => {
    test("every key the native side holds is answered exactly once: the page's replayed, Couch's consumed", () => {
      const { web, view } = make();
      web.show();
      press(view(), key({ id: 11, keyCode: 6, characters: "z" }));
      press(view(), key({ id: 2, ...ARROW_UP }));
      press(view(), key({ id: 13, keyCode: 6, characters: "z", down: false }));
      press(view(), key({ id: 14, keyCode: 4, characters: "h", down: false }));
      expect(view().keyAnswers).toEqual([
        [11, true],
        [2, false],
        [13, true],
        [14, false],
      ]);
    });

    test("a key that already reached the view (id 0) is never answered", () => {
      const { web, view } = make();
      web.show();
      press(view(), key({ id: 0, keyCode: 6, characters: "z" }));
      expect(view().keyAnswers).toEqual([]);
      expect(events).toContainEqual({ type: "input" });
    });

    test("the gate, find, typed text and a key release are answered as consumed or replayed by the same rules", () => {
      const { web, view } = make();
      web.show();
      press(view(), key({ id: 21, keyCode: 44, characters: "/" }));
      press(
        view(),
        key({
          id: 22,
          keyCode: 3,
          characters: "f",
          charactersIgnoringModifiers: "f",
          flags: 1 << 20,
        }),
      );
      web.captureText(true);
      press(view(), key({ id: 23, keyCode: 6, characters: "z" }));
      press(view(), key({ id: 24, keyCode: 53, characters: "\u001b" }));
      expect(view().keyAnswers).toEqual([
        [21, false],
        [22, false],
        [23, false],
        [24, false],
      ]);
    });
  });

  describe("IME and typing", () => {
    test("with a field of the page focused, the view is told, so typing goes to WebKit unheld", () => {
      const { web, view } = make();
      web.show();
      field(view(), "couch:field-focused");
      expect(view().routing.at(-1)).toEqual({ ...ON, fieldFocused: true });
      field(view(), "couch:field-blurred");
      expect(view().routing.at(-1)).toEqual(ON);
    });

    test("a new page, hide and unload clear the field flag in the routing", () => {
      const { web, view } = make();
      web.show();
      field(view(), "couch:field-focused");
      view().emit({ type: "navigated", url: "https://www.netflix.com/browse" });
      expect(view().routing.at(-1)).toEqual(ON);
      field(view(), "couch:field-focused");
      web.hide();
      web.show();
      expect(view().routing.at(-1)).toEqual(ON);
    });

    test("Couch's own search capture holds every key, as in Electron, even with a field focused", () => {
      const { web, view } = make();
      web.show();
      field(view(), "couch:field-focused");
      web.captureText(true);
      expect(view().routing.at(-1)).toEqual({
        keys: true,
        captureCommands: true,
        fieldFocused: true,
        pointer: true,
      });
      press(view(), key({ id: 31, keyCode: 0, characters: "a" }));
      press(view(), key({ id: 32, keyCode: 51, characters: "\u007f" }));
      press(view(), key({ id: 33, keyCode: 36, characters: "\r" }));
      press(view(), key({ id: 34, keyCode: 53, characters: "\u001b" }));
      expect(events.filter((e) => e.type === "edit")).toEqual([
        { type: "edit", edit: { insert: "a" } },
        { type: "edit", edit: { erase: "char" } },
        { type: "edit", edit: { done: "submit" } },
        { type: "edit", edit: { done: "cancel" } },
      ]);
      expect(view().replayed).toEqual([]);
    });

    test("the picture-off gate holds keys even with a field focused", () => {
      const { web, view } = make();
      web.show();
      field(view(), "couch:field-focused");
      web.setOverlay(true);
      expect(view().routing.at(-1)).toMatchObject({ captureCommands: true, fieldFocused: true });
    });
  });

  describe("wake pointer", () => {
    const wake = (view: FakeView, body: unknown, frame: WebKitFrame = MAIN) =>
      view.emit({ type: "message", name: "couch", body, frame });

    test("Couch's wake of a player's bar becomes a real move in the view, without leaving D-pad mode", () => {
      const { web, view } = make();
      web.show();
      wake(view(), { type: "wake-pointer", x: 521, y: 415 });
      expect(view().wakes).toEqual([[521, 415]]);
      expect(events.filter((e) => e.type === "input")).toEqual([]);
    });

    test("the page script that sends it keeps the shield (the mark the page's own listener checks)", async () => {
      const { web, view } = make();
      web.show();
      const couch = view()
        .scripts.filter((_s, i) => view().worlds[i] === "couch")
        .join("\n");
      expect(couch).toContain("__couchWake");
      expect(couch).toContain("wake-pointer");
    });

    test("only the App's own main frame can ask, with finite numbers on the page", () => {
      const { web, view } = make();
      web.show();
      wake(
        view(),
        { type: "wake-pointer", x: 1, y: 2 },
        { isMainFrame: false, origin: MAIN.origin },
      );
      wake(
        view(),
        { type: "wake-pointer", x: 1, y: 2 },
        { isMainFrame: true, origin: "https://evil.example" },
      );
      wake(view(), { type: "wake-pointer", x: "1", y: 2 });
      wake(view(), { type: "wake-pointer", x: Number.NaN, y: 2 });
      wake(view(), { type: "wake-pointer", x: -5, y: 2 });
      wake(view(), { type: "wake-pointer", x: 1e9, y: 2 });
      wake(view(), { type: "wake-pointer", x: 1, y: 2, extra: true });
      expect(view().wakes).toEqual([]);
    });

    test("while hidden nothing is woken", () => {
      const { web, view } = make();
      web.show();
      web.hide();
      wake(view(), { type: "wake-pointer", x: 1, y: 2 });
      expect(view().wakes).toEqual([]);
    });

    test("with the cursor hidden for playback, a wake neither shows it nor counts as the mouse", () => {
      const clock = new FakeClock();
      const hidden: boolean[] = [];
      const native = { move: () => {} };
      const moves = new MouseMoves((cb) => {
        native.move = cb;
        return () => {};
      });
      const hider = new CursorHider({
        clock,
        onMouseMoved: moves.subscribe,
        setHidden: (h) => hidden.push(h),
      });
      const { web, view } = make();
      web.show();
      hider.playing(true);
      clock.advance(3100);
      expect(hidden).toEqual([true]);
      wake(view(), { type: "wake-pointer", x: 521, y: 415 });
      clock.advance(3100);
      expect(view().wakes).toHaveLength(1);
      expect(hidden).toEqual([true]);
      native.move();
      expect(hidden).toEqual([true, false]);
    });
  });

  describe("coexisting with the cursor and edge watcher (097)", () => {
    test("showing, hiding, overlays and unloading again and again never leave the view taking input it shouldn't", () => {
      const { web, view } = make();
      for (let i = 0; i < 5; i++) {
        web.show();
        expect(view().routing.at(-1)).toEqual(ON);
        web.setOverlay(true);
        expect(view().routing.at(-1)).toMatchObject({ pointer: false, captureCommands: true });
        web.setOverlay(false);
        web.hide();
        expect(view().routing.at(-1)).toEqual(OFF);
      }
      web.unload();
      expect(view().routing.at(-1)).toEqual(OFF);
      expect(view().destroyed).toBe(true);
    });

    test("the household's mouse stays one subscription of the shared watcher while the cursor hider turns on and off", () => {
      const starts: number[] = [];
      let stops = 0;
      const moves = new MouseMoves(() => {
        starts.push(1);
        return () => void stops++;
      });
      const hider = new CursorHider({
        clock: new FakeClock(),
        onMouseMoved: moves.subscribe,
        setHidden: () => {},
      });
      const { web } = make();
      for (let i = 0; i < 3; i++) {
        web.show();
        hider.playing(true);
        hider.playing(false);
        web.hide();
      }
      expect(starts).toHaveLength(3);
      expect(stops).toBe(3);
      web.unload();
      hider.release();
      expect(stops).toBe(3);
    });
  });

  describe("Remote keys", () => {
    test("every key is a native press, down then up, with no Mac keyboard rules in the way", () => {
      const { web, view } = make();
      web.setKeyGate(() => true);
      web.show();
      for (const k of ["up", "down", "left", "right", "ok"] as const) web.sendKey(k);
      expect(view().keys.map(([name]) => name)).toEqual(
        ["Up", "Down", "Left", "Right", "Return"].flatMap((n) => [n, n]),
      );
      expect(view().replayed).toEqual([]);
    });
  });

  describe("Remote keys through the fake bridge", () => {
    test("every key name a description sends, and Space, is one the native side knows", () => {
      for (const name of [...Object.values(netflix.keyCodes), "Space"])
        expect(WEBKIT_KEY_NAMES).toContain(name);
    });

    test("play/pause goes through the App's own control, not a key", () => {
      const { web, view } = make();
      web.show();
      web.playPause();
      expect(view().evaluated.at(-1)).toContain("control-play-pause");
      expect(view().keys).toEqual([]);
    });

    test("a skip without a position drives the scrubber with Left or Right", () => {
      const { web, view } = make();
      web.show();
      web.seekBy(-10);
      web.seekBy(10);
      expect(view().keys.map(([k, down]) => `${k}:${down}`)).toEqual([
        "Left:true",
        "Left:false",
        "Right:true",
        "Right:false",
      ]);
    });

    test("Back asks the page where it is before deciding between history and Escape", async () => {
      const { web, view } = make();
      web.show();
      web.sendKey("back");
      await vi.waitFor(() =>
        expect(view().evaluated.some((e) => e.includes("__couchPlayerBack"))).toBe(true),
      );
    });
  });

  describe("the mouse", () => {
    test("a Couch overlay (Quick settings, a confirmation, Picture off) takes the pointer and every key", () => {
      const { web, view } = make();
      web.show();
      web.setOverlay(true);
      expect(view().routing.at(-1)).toEqual({ ...ON, captureCommands: true, pointer: false });
      web.setOverlay(false);
      expect(view().routing.at(-1)).toEqual(ON);
    });

    test("an overlay set while hidden applies once the view is shown", () => {
      const { web, view } = make();
      web.show();
      web.hide();
      web.setOverlay(true);
      expect(view().routing.at(-1)).toEqual(OFF);
      web.show();
      expect(view().routing.at(-1)).toEqual({ ...ON, captureCommands: true, pointer: false });
    });

    test("a new view after unload is routed again once shown", () => {
      const { web } = make();
      web.show();
      web.hide();
      web.unload();
      web.show();
      expect(views.at(-1)!.routing.at(-1)).toEqual(ON);
    });

    test("D-pad mode and the hidden cursor are the page script's: it runs in the page, and only trusted moves end the shield", () => {
      const { web, view } = make();
      web.show();
      const couch = view()
        .scripts.filter((_s, i) => view().worlds[i] === "couch")
        .join("\n");
      expect(couch).toContain("couch-shield");
      expect(couch).toContain("cursor = 'none'");
      expect(couch).toContain("e.isTrusted");
    });
  });

  describe("focus", () => {
    test("the view is the first responder again when an overlay closes", async () => {
      const { web, view } = make();
      web.show();
      await vi.waitFor(() => expect(view().focused).toBeGreaterThan(0));
      const before = view().focused;
      web.setOverlay(true);
      expect(view().focused).toBe(before);
      web.setOverlay(false);
      expect(view().focused).toBe(before + 1);
    });

    test("a repeated overlay state does not steal the focus again", async () => {
      const { web, view } = make();
      web.show();
      await vi.waitFor(() => expect(view().focused).toBeGreaterThan(0));
      web.setOverlay(false);
      web.setOverlay(false);
      const before = view().focused;
      web.setOverlay(false);
      expect(view().focused).toBe(before);
    });

    test("nothing is focused while hidden", () => {
      const { web, view } = make();
      web.show();
      web.hide();
      const before = view().focused;
      web.setOverlay(true);
      web.setOverlay(false);
      expect(view().focused).toBe(before);
    });
  });
});
