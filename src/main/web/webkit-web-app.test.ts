import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { netflixDescription } from "../apps/netflix/netflix-web.ts";
import type { YouTubeEvent } from "../ports/youtube.ts";
import {
  webkitStoreId,
  type WebKitBridge,
  type WebKitEvent,
  type WebKitView,
  type WebKitViewOptions,
} from "./webkit-bridge.ts";
import { PAGE_HOOKS_FUNCTION } from "./page-hooks.ts";
import { WebKitWebApp, type WebKitHostWindow } from "./webkit-web-app.ts";

class FakeView implements WebKitView {
  options: WebKitViewOptions;
  loads: string[] = [];
  scripts: string[] = [];
  handlers: string[] = [];
  frames: Array<[number, number, number, number]> = [];
  visible: boolean[] = [];
  keys: Array<[string, boolean]> = [];
  evaluated: string[] = [];
  focused = 0;
  destroyed = false;
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
  async evaluate(script: string) {
    this.evaluated.push(script);
    for (const [part, answer] of this.answers) if (script.includes(part)) return answer;
    return undefined;
  }
  addUserScript(source: string) {
    this.log.push("script");
    this.scripts.push(source);
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
  sendKey(key: string, down: boolean) {
    this.keys.push([key, down]);
  }
  onEvent(l: (e: WebKitEvent) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  destroy() {
    this.destroyed = true;
  }
  emit(e: WebKitEvent) {
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
};

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

function make(): { web: WebKitWebApp; view: () => FakeView } {
  const web = new WebKitWebApp(netflix, bridge, win);
  events = [];
  web.onEvent((e) => events.push(e));
  return { web, view: () => views.at(-1)! };
}

beforeEach(() => {
  views.length = 0;
});

describe("showing and hiding", () => {
  test("makes no view and no request until it is shown", () => {
    make();
    expect(views).toEqual([]);
  });

  test("shows a view with Safari's identity and the App's own store, filling the window", async () => {
    const { web, view } = make();
    web.show();
    expect(view().options).toEqual({
      storeId: webkitStoreId("netflix"),
      userAgent: "Mozilla/5.0 Safari-UA",
    });
    expect(view().frames.at(-1)).toEqual([0, 0, 1280, 720]);
    expect(view().visible.at(-1)).toBe(true);
    await vi.waitFor(() => expect(view().focused).toBeGreaterThan(0));
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
    view().emit({ type: "message", name: "other", body: { type: "route", url: "x", page: {} } });
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
