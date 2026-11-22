import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const fake = vi.hoisted(() => {
  class FakeContents {
    url = "about:blank";
    loading = false;
    backAnswer: unknown = "";
    entries: Array<{ url: string }> = [];
    active = 0;
    handlers = new Map<string, Array<(...args: any[]) => void>>();
    scripts: string[] = [];
    loads: string[] = [];
    inputs: Array<{ type: string; keyCode: string }> = [];
    goBack = vi.fn();
    debugger = {
      isAttached: () => true,
      attach: () => {},
      on: () => {},
      sendCommand: async () => ({}),
    };
    navigationHistory = {
      getAllEntries: () => this.entries,
      getActiveIndex: () => this.active,
      goBack: () => this.goBack(),
    };
    on(event: string, fn: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
      return this;
    }
    once = this.on;
    emit(event: string, ...args: any[]) {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
    }
    getURL() {
      return this.url;
    }
    isLoading() {
      return this.loading;
    }
    async loadURL(url: string) {
      this.loads.push(url);
      this.url = url;
    }
    async executeJavaScript(script: string) {
      this.scripts.push(script);
      if (script.includes("__couchPlayerBack")) return this.backAnswer;
      if (script.includes("b.innerText")) return false;
      return undefined;
    }
    sendInputEvent(event: { type: string; keyCode: string }) {
      this.inputs.push(event);
      // Electron runs a sent event through before-input-event like a real key.
      this.emit(
        "before-input-event",
        { preventDefault() {} },
        { type: event.type, key: event.keyCode },
      );
    }
    setUserAgent() {}
    setAudioMuted() {}
    css: string[] = [];
    async insertCSS(css: string) {
      this.css.push(css);
      return "key";
    }
    focus() {}
    close() {}
    reload() {}
    zoomCalls: Array<string | number> = [];
    zoom = 1;
    setZoomMode(mode: string) {
      this.zoomCalls.push(mode);
    }
    setZoomFactor(factor: number) {
      this.zoomCalls.push(factor);
      this.zoom = factor;
    }
    getZoomFactor() {
      return this.zoom;
    }
  }
  const views: FakeContents[] = [];
  const counts = { hooksAdded: 0, preloadsRegistered: 0, preloadsRemoved: 0 };
  /** What the fake Session holds: every session-level listener a host may leave behind. */
  const held: Record<string, unknown> = {};
  /** The userData folder of the test running now, so no two tests (or runs) share a preload folder. */
  const state = { userData: "", session: undefined as unknown };
  return { FakeContents, views, counts, held, state };
});

vi.mock("electron", () => {
  class WebContentsView {
    webContents = new fake.FakeContents();
    constructor() {
      fake.views.push(this.webContents);
    }
    setVisible() {}
    setBounds() {}
  }
  const makeSession = () => ({
    setUserAgent() {},
    setPermissionRequestHandler(h: unknown) {
      fake.held.permissionRequest = h;
    },
    setPermissionCheckHandler(h: unknown) {
      fake.held.permissionCheck = h;
    },
    webRequest: {
      onBeforeRequest(h: unknown) {
        fake.held.beforeRequest = h;
      },
      onBeforeSendHeaders(h: unknown) {
        fake.held.beforeSendHeaders = h;
      },
      onHeadersReceived(h: unknown) {
        fake.held.headersReceived = h;
      },
    },
    registerPreloadScript: () => {
      fake.counts.preloadsRegistered++;
      return "id";
    },
    unregisterPreloadScript() {
      fake.counts.preloadsRemoved++;
    },
  });
  return {
    app: { getPath: () => fake.state.userData, focus() {} },
    BrowserWindow: class {},
    WebContentsView,
    clipboard: { readText: () => "" },
    components: { whenReady: async () => {} },
    // One session per test, so request hooks a test leaves behind never carry over to the next.
    session: { fromPartition: () => (fake.state.session ??= makeSession()) },
  };
});

import { bitchordDescription } from "../apps/bitchord/bitchord-web.ts";
import { HOST_CONSOLE_PREFIX } from "./couch-host.ts";
import { netflixDescription } from "../apps/netflix/netflix-web.ts";
import { youtubeDescription } from "../apps/youtube/youtube-web.ts";
import { ElectronWebApp } from "./electron-web-app.ts";
import { HIDE_SCROLLBARS_CSS } from "./hide-scrollbars.ts";
import { KEY_CASES } from "./keyboard-policy.cases.ts";

const winResize = { n: 0 };
const children = new Set<unknown>();
const resizeHandlers = new Set<() => void>();
const winWidth = { pt: 1280 };
const win: any = {
  contentView: {
    addChildView: (v: unknown) => children.add(v),
    removeChildView: (v: unknown) => children.delete(v),
  },
  on(event: string, fn?: () => void) {
    if (event === "resize") {
      winResize.n++;
      if (fn) resizeHandlers.add(fn);
    }
  },
  off(event: string, fn?: () => void) {
    if (event === "resize") {
      winResize.n--;
      if (fn) resizeHandlers.delete(fn);
    }
  },
  getContentBounds: () => ({ width: winWidth.pt, height: 720 }),
  isDestroyed: () => true,
  webContents: { focus() {} },
};

const netflix = netflixDescription("130.0.0.0");
const HOME = netflix.url;
const PAGE = "https://www.netflix.com/browse";

let contents: InstanceType<typeof fake.FakeContents>;

/** A Netflix host whose home has been asked for once, then reset so a later load is the one under test. */
async function startedNetflix() {
  const web = new ElectronWebApp(netflix, win);
  contents = fake.views.at(-1)!;
  web.start();
  await vi.waitFor(() => expect(contents.loads).toContain(HOME));
  contents.loads.length = 0;
  return web;
}

beforeEach(() => {
  fake.views.length = 0;
  fake.counts.preloadsRegistered = fake.counts.preloadsRemoved = 0;
  winResize.n = 0;
  winWidth.pt = 1280;
  resizeHandlers.clear();
  children.clear();
  for (const k of Object.keys(fake.held)) delete fake.held[k];
  fake.state.session = undefined;
  fake.state.userData = mkdtempSync(join(tmpdir(), "couch-electron-web-"));
});

afterEach(() => {
  rmSync(fake.state.userData, { recursive: true, force: true });
});

describe("dispose (an engine switch)", () => {
  test("every session-level listener the host registered is released: permission handlers and request hooks", () => {
    const web = new ElectronWebApp(netflix, win);
    expect(typeof fake.held.permissionRequest).toBe("function");
    expect(typeof fake.held.permissionCheck).toBe("function");
    expect(typeof fake.held.beforeRequest).toBe("function");
    expect(typeof fake.held.beforeSendHeaders).toBe("function");
    expect(typeof fake.held.headersReceived).toBe("function");
    web.dispose();
    expect(fake.held).toEqual({
      permissionRequest: null,
      permissionCheck: null,
      beforeRequest: null,
      beforeSendHeaders: null,
      headersReceived: null,
    });
  });

  test("a newer host on the same session keeps its own handlers when the older one is disposed", () => {
    const old = new ElectronWebApp(netflix, win);
    const fresh = new ElectronWebApp(netflix, win);
    old.dispose();
    expect(typeof fake.held.permissionCheck).toBe("function");
    expect(typeof fake.held.beforeRequest).toBe("function");
    fresh.dispose();
    expect(fake.held.permissionCheck).toBeNull();
    expect(fake.held.beforeRequest).toBeNull();
  });

  test("takes the view out of the window, closes it, stops listening to the window and reports home", async () => {
    const web = new ElectronWebApp(netflix, win);
    const events: unknown[] = [];
    web.onEvent((e) => events.push(e));
    web.show();
    const wc = fake.views.at(-1)!;
    const close = vi.spyOn(wc, "close");
    expect(winResize.n).toBe(1);
    web.dispose();
    expect(children.size).toBe(0);
    expect(close).toHaveBeenCalled();
    expect(winResize.n).toBe(0);
    expect(events.at(-1)).toEqual({ type: "route", home: true });
  });

  test("the preload it registered is removed, so a later host starts clean", () => {
    const web = new ElectronWebApp(netflix, win);
    web.dispose();
    expect(fake.counts.preloadsRemoved).toBeGreaterThanOrEqual(1);
  });

  test("nothing starts afterwards: no new view, no load", async () => {
    const web = new ElectronWebApp(netflix, win);
    web.dispose();
    const views = fake.views.length;
    web.show();
    web.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.views.length).toBe(views);
    expect(fake.views.every((v) => v.loads.length === 0)).toBe(true);
  });

  test("a disposed host leaves no timers", () => {
    vi.useFakeTimers();
    try {
      const web = new ElectronWebApp(netflix, win);
      web.show();
      web.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("when a web App loads", () => {
  test("Netflix makes no site request until it is shown", async () => {
    const web = new ElectronWebApp(netflix, win);
    contents = fake.views.at(-1)!;
    await new Promise((r) => setTimeout(r, 30));
    expect(contents.loads).toEqual([]);
    expect(contents.url).toBe("about:blank");
    web.show();
    await vi.waitFor(() => expect(contents.loads).toContain(HOME));
  });

  test("an unstarted App loads on show", async () => {
    const web = new ElectronWebApp(netflix, win);
    contents = fake.views.at(-1)!;
    web.show();
    await vi.waitFor(() => expect(contents.loads.filter((u) => u === HOME)).toHaveLength(1));
  });

  test("a repeated show doesn't start loading again", async () => {
    const web = new ElectronWebApp(netflix, win);
    contents = fake.views.at(-1)!;
    web.show();
    await vi.waitFor(() => expect(contents.loads).toContain(HOME));
    contents.url = PAGE;
    web.hide();
    web.show();
    web.show();
    await new Promise((r) => setTimeout(r, 30));
    expect(contents.loads.filter((u) => u === HOME)).toHaveLength(1);
  });

  test("an idle unload then show recreates the view and loads again", async () => {
    const web = new ElectronWebApp(netflix, win);
    const first = fake.views.at(-1)!;
    web.show();
    await vi.waitFor(() => expect(first.loads).toContain(HOME));
    web.hide();
    web.unload();
    const second = fake.views.at(-1)!;
    expect(second).not.toBe(first);
    expect(second.loads).toEqual([]);
    web.show();
    await vi.waitFor(() => expect(second.loads).toContain(HOME));
  });
});

describe("showing a web App whose page is blank", () => {
  test("reloads the App's home", async () => {
    const web = await startedNetflix();
    contents.url = "about:blank";
    web.show();
    await vi.waitFor(() => expect(contents.loads).toEqual([HOME]));
  });

  test("leaves a page that has loaded alone", async () => {
    const web = await startedNetflix();
    contents.url = PAGE;
    web.show();
    await new Promise((r) => setTimeout(r, 20));
    expect(contents.loads).toEqual([]);
  });

  test("reloads when the renderer crashed while shown", async () => {
    const web = await startedNetflix();
    contents.url = PAGE;
    web.show();
    await new Promise((r) => setTimeout(r, 20));
    contents.emit("render-process-gone");
    await vi.waitFor(() => expect(contents.loads).toEqual([HOME]));
  });
});

describe("Back by history", () => {
  async function back(entries: string[], active: number) {
    const web = await startedNetflix();
    contents.entries = entries.map((url) => ({ url }));
    contents.active = active;
    web.sendKey("back");
    await new Promise((r) => setTimeout(r, 20));
  }

  test("goes back through the page's own history, not the view's", async () => {
    await back(["about:blank", PAGE, `${PAGE}?jbv=1`], 2);
    expect(contents.scripts).toContain("history.back()");
    expect(contents.goBack).not.toHaveBeenCalled();
  });

  test("never lands on the blank page the view starts on", async () => {
    await back(["about:blank", PAGE], 1);
    expect(contents.scripts).not.toContain("history.back()");
    expect(contents.goBack).not.toHaveBeenCalled();
  });
});

describe("the phone's play/pause", () => {
  test("reaches Netflix's adapter, not the media key", () => {
    const web = new ElectronWebApp(netflix, win);
    contents = fake.views.at(-1)!;
    web.playPause();
    expect(contents.scripts).toEqual([netflix.playback!.playPause!()]);
    expect(contents.inputs).toEqual([]);
  });

  test("is the media key for an App with no adapter (YouTube)", () => {
    const web = new ElectronWebApp(youtubeDescription("130.0.0.0"), win);
    contents = fake.views.at(-1)!;
    web.playPause();
    expect(contents.scripts).toEqual([]);
    expect(contents.inputs).toEqual([
      { type: "keyDown", keyCode: "MediaPlayPause" },
      { type: "keyUp", keyCode: "MediaPlayPause" },
    ]);
  });
});

describe("the key gate (Picture off's cover)", () => {
  test("never sees the media key the host sends for play/pause, so it can't loop back", () => {
    const web = new ElectronWebApp(youtubeDescription("130.0.0.0"), win);
    contents = fake.views.at(-1)!;
    const seen: string[] = [];
    web.setKeyGate((_event, input) => {
      seen.push(input.key);
      return false;
    });
    web.playPause();
    expect(contents.inputs.length).toBe(2);
    expect(seen).toEqual([]);
  });
});

describe("desktop scrollbars", () => {
  test("are hidden on every Netflix document", () => {
    new ElectronWebApp(netflix, win);
    const wc = fake.views.at(-1)!;
    wc.emit("dom-ready");
    wc.emit("dom-ready");
    expect(wc.css).toEqual([HIDE_SCROLLBARS_CSS, HIDE_SCROLLBARS_CSS]);
  });

  test("are left alone for an App that doesn't ask (YouTube)", () => {
    new ElectronWebApp(youtubeDescription("130.0.0.0"), win);
    const wc = fake.views.at(-1)!;
    wc.emit("dom-ready");
    expect(wc.css).toEqual([]);
  });
});

describe("the page's confirmation buttons", () => {
  test("a click or hover in the page becomes an event", async () => {
    const web = await startedNetflix();
    const events: unknown[] = [];
    web.onEvent((e) => events.push(e));
    contents.emit("console-message", { message: "couch:confirm:1" });
    contents.emit("console-message", { message: "couch:confirm-hover:0" });
    expect(events).toEqual([
      { type: "confirm", index: 1, answer: true },
      { type: "confirm", index: 0, answer: false },
    ]);
  });
});

describe("page input (the household using the page itself)", () => {
  function watched() {
    const web = new ElectronWebApp(youtubeDescription("130.0.0.0"), win);
    const wc = fake.views.at(-1)!;
    const events: Array<{ type: string }> = [];
    web.onEvent((e) => events.push(e));
    const inputs = () => events.filter((e) => e.type === "input").length;
    const key = (k: string, extra: Record<string, unknown> = {}) => {
      const event = { preventDefault: vi.fn() };
      wc.emit("before-input-event", event, { type: "keyDown", key: k, ...extra });
      return event;
    };
    return { web, wc, inputs, key };
  }

  test("a mouse press reaches the page", () => {
    const { wc, inputs } = watched();
    wc.emit("before-mouse-event", {}, { type: "mouseDown" });
    expect(inputs()).toBe(1);
    wc.emit("before-mouse-event", {}, { type: "mouseUp" });
    expect(inputs()).toBe(1);
  });

  test("a key that reaches the page counts, such as YouTube's Shift+> and Shift+<", () => {
    const { inputs, key } = watched();
    key(">", { shift: true });
    key("<", { shift: true });
    expect(inputs()).toBe(2);
  });

  test("a key Couch turns into a command or swallows doesn't count", () => {
    const { inputs, key } = watched();
    key(" ");
    key("ArrowLeft");
    key("Enter");
    key("/");
    key("f", { meta: true });
    expect(inputs()).toBe(0);
  });

  test("a key the Picture off gate takes doesn't count", () => {
    const { web, inputs, key } = watched();
    web.setKeyGate(() => true);
    key(">", { shift: true });
    expect(inputs()).toBe(0);
  });

  test("nothing counts while the phone is typing (text capture), mouse included", () => {
    const { web, wc, inputs, key } = watched();
    web.captureText(true);
    key("a");
    wc.emit("before-mouse-event", {}, { type: "mouseDown" });
    expect(inputs()).toBe(0);
  });

  test("Couch's own synthetic input doesn't count", () => {
    const { web, inputs } = watched();
    web.playPause();
    web.sendKey("ok");
    expect(inputs()).toBe(0);
  });
});

describe("the field flag across navigations (ticket 129)", () => {
  function focused() {
    const web = new ElectronWebApp(netflix, win);
    const wc = fake.views.at(-1)!;
    const out: unknown[] = [];
    web.onEvent((e) => out.push(e));
    wc.emit("console-message", { message: "couch:field-focused" });
    const typeH = () => {
      const event = { preventDefault: vi.fn() };
      wc.emit("before-input-event", event, { type: "keyDown", key: "h" });
      return event.preventDefault.mock.calls.length === 0;
    };
    const navigate = (inPlace: boolean, isMainFrame: boolean) =>
      wc.emit(
        "did-start-navigation",
        {},
        "https://www.netflix.com/search?q=t",
        inPlace,
        isMainFrame,
      );
    return { out, typeH, navigate };
  }
  const homeKey = (out: unknown[]) => out.some((e) => JSON.stringify(e).includes("home"));

  test("a main-frame in-place navigation keeps the field: h goes to the page", () => {
    const { out, typeH, navigate } = focused();
    navigate(true, true);
    expect(typeH()).toBe(true);
    expect(homeKey(out)).toBe(false);
  });

  test("a main-frame cross-document navigation clears it: h is Home", () => {
    const { out, typeH, navigate } = focused();
    navigate(false, true);
    expect(typeH()).toBe(false);
    expect(homeKey(out)).toBe(true);
  });

  test("a subframe navigation leaves it", () => {
    const { out, typeH, navigate } = focused();
    navigate(false, false);
    expect(typeH()).toBe(true);
    expect(homeKey(out)).toBe(false);
  });
});

describe("the shared keyboard rules, through the Electron adapter", () => {
  test.each(KEY_CASES)("$name", ({ input, state, events, page }) => {
    const web = new ElectronWebApp(netflix, win);
    const wc = fake.views.at(-1)!;
    const out: unknown[] = [];
    web.onEvent((e) => out.push(e));
    web.captureText(state.capturing ?? false);
    if (state.fieldFocused) wc.emit("console-message", { message: "couch:field-focused" });
    if (state.gate)
      web.setKeyGate((event) => {
        event.preventDefault();
        return true;
      });
    const event = { preventDefault: vi.fn() };
    wc.emit("before-input-event", event, { ...input });
    expect(out).toEqual(events);
    expect(event.preventDefault.mock.calls.length === 0).toBe(page);
  });
});

describe("a web App with a bridge and network rules (BitChord)", () => {
  const SITE = "https://bitchord-8bw.pages.dev";
  const request = (id: string) => ({
    channel: "bitchord-bridge",
    protocol: 1,
    direction: "to-extension",
    id,
    method: "ping",
    params: {},
  });
  const sendBridge = (frame: { parent: unknown; origin: string }, message: unknown) =>
    contents.emit("console-message", {
      message: `${HOST_CONSOLE_PREFIX}${JSON.stringify({ type: "bridge", request: message })}`,
      frame,
    });
  const posted = () => contents.scripts.filter((s) => s.startsWith("window.postMessage("));
  const bitchord = () =>
    bitchordDescription(
      "130.0.0.0",
      {
        request: () => Promise.reject(new Error("no")),
        manifest: () => Promise.resolve('{"version":"0.4.9"}'),
      },
      {},
    );

  test("a bridge request from the App's main frame is answered by posting the envelope into the page, to its origin", async () => {
    const web = new ElectronWebApp(bitchord(), win);
    contents = fake.views.at(-1)!;
    sendBridge({ parent: null, origin: SITE }, request("r1"));
    await vi.waitFor(() => expect(posted()).toHaveLength(1));
    const [, body, to] = /^window\.postMessage\((.*), ("[^"]*")\)$/.exec(posted()[0]!)!;
    expect(JSON.parse(to!)).toBe(SITE);
    expect(JSON.parse(body!)).toMatchObject({
      channel: "bitchord-bridge",
      direction: "to-page",
      id: "r1",
      ok: true,
      result: { version: "0.4.9", browser: "chromium" },
    });
    web.dispose();
  });

  test.each([
    ["a sub-frame of the App", { parent: {}, origin: SITE }],
    ["another origin's main frame", { parent: null, origin: "https://evil.example" }],
  ])("a bridge request from %s is ignored", async (_name, frame) => {
    const web = new ElectronWebApp(bitchord(), win);
    contents = fake.views.at(-1)!;
    sendBridge(frame, request("r2"));
    await new Promise((r) => setTimeout(r, 30));
    expect(posted()).toEqual([]);
    web.dispose();
  });

  test("a malformed bridge request is ignored", async () => {
    const web = new ElectronWebApp(bitchord(), win);
    contents = fake.views.at(-1)!;
    sendBridge({ parent: null, origin: SITE }, { ...request("r3"), channel: "other" });
    await new Promise((r) => setTimeout(r, 30));
    expect(posted()).toEqual([]);
    web.dispose();
  });

  test("an App with no bridge ignores a bridge request", async () => {
    const web = new ElectronWebApp(netflix, win);
    contents = fake.views.at(-1)!;
    sendBridge({ parent: null, origin: "https://www.netflix.com" }, request("r4"));
    await new Promise((r) => setTimeout(r, 30));
    expect(posted()).toEqual([]);
    web.dispose();
  });

  const received = (url: string) =>
    new Promise<any>((res) =>
      (fake.held.headersReceived as any)({ url, responseHeaders: { Server: ["s"] } }, res),
    );
  const GV = "https://rr1---sn-a.googlevideo.com/videoplayback?c=WEB";

  test("the response-headers hook applies BitChord's rules to its own session", async () => {
    const web = new ElectronWebApp(bitchord(), win);
    expect(await received(GV)).toEqual({
      responseHeaders: {
        Server: ["s"],
        "Access-Control-Allow-Origin": ["*"],
        "Access-Control-Expose-Headers": ["*"],
      },
    });
    web.dispose();
  });

  test("YouTube's and Netflix's sessions leave the same responses untouched", async () => {
    for (const description of [netflix, youtubeDescription("130.0.0.0")]) {
      const web = new ElectronWebApp(description, win);
      expect(await received(GV)).toEqual({});
      web.dispose();
    }
  });

  test("BitChord's request rules set YouTube's Origin on its own session only", () => {
    const send = (description: any) => {
      const web = new ElectronWebApp(description, win);
      let out: any;
      (fake.held.beforeSendHeaders as any)(
        { url: GV, requestHeaders: { Origin: SITE } },
        (r: any) => (out = r.requestHeaders),
      );
      web.dispose();
      return out;
    };
    expect(send(bitchord())).toMatchObject({ Origin: "https://www.youtube.com" });
    expect(send(netflix)).toEqual({ Origin: SITE });
  });
});

describe("Text size", () => {
  const WIDTH = 1280;
  const sized = { ...netflix, textSize: { targetWidth: WIDTH } };
  const resize = (pt: number) => {
    winWidth.pt = pt;
    resizeHandlers.forEach((fn) => fn());
  };

  test("a page without textSize is isolated and stays at zoom 1, whatever the size or window", () => {
    const web = new ElectronWebApp(netflix, win);
    const wc = fake.views.at(-1)!;
    expect(web.supportsTextSize).toBe(false);
    web.setTextSize("larger");
    resize(1920);
    wc.emit("did-navigate", {}, "https://www.netflix.com/browse");
    expect(wc.zoomCalls[0]).toBe("isolated");
    expect(wc.zoom).toBe(1);
    expect(wc.zoomCalls.slice(1).every((c) => c === 1)).toBe(true);
  });

  test("a page with textSize says it supports Text size", () => {
    expect(new ElectronWebApp(sized, win).supportsTextSize).toBe(true);
  });

  test("isolated mode is set before the first zoom, on every web contents the host makes", () => {
    const web = new ElectronWebApp(sized, win);
    web.start();
    web.unload();
    for (const wc of fake.views) {
      expect(wc.zoomCalls[0]).toBe("isolated");
      expect(wc.zoomCalls.filter((c) => c === "isolated")).toHaveLength(1);
    }
    expect(fake.views.length).toBeGreaterThan(1);
  });

  test("the zoom follows the formula at load, after a resize, a size change and a navigation to another origin", () => {
    winWidth.pt = 1920;
    const web = new ElectronWebApp(sized, win);
    const wc = fake.views.at(-1)!;
    web.show();
    wc.emit("dom-ready");
    expect(wc.zoom).toBeCloseTo(1.5, 5);
    resize(2560);
    expect(wc.zoom).toBeCloseTo(2, 5);
    web.setTextSize("larger");
    expect(wc.zoom).toBeCloseTo(2.4, 5);
    wc.zoom = 1;
    wc.emit("did-navigate", {}, "https://other.example/");
    expect(wc.zoom).toBeCloseTo(2.4, 5);
    web.setTextSize("smaller");
    expect(wc.zoom).toBeCloseTo(1.7, 5);
  });

  test("a resize while the App is hidden still updates the zoom (a display move)", () => {
    const web = new ElectronWebApp(sized, win);
    const wc = fake.views.at(-1)!;
    expect(web.supportsTextSize).toBe(true);
    resize(1920);
    expect(wc.zoom).toBeCloseTo(1.5, 5);
  });

  test("the zoom depends on the window's points only, not on the display's scale", () => {
    winWidth.pt = 1920;
    const web = new ElectronWebApp(sized, win);
    const wc = fake.views.at(-1)!;
    web.show();
    const at1x = wc.zoom;
    (globalThis as any).devicePixelRatio = 2;
    web.setTextSize("default");
    expect(wc.zoom).toBe(at1x);
    delete (globalThis as any).devicePixelRatio;
  });

  test("another web contents of the same App stays at 1 while the App's is zoomed", () => {
    winWidth.pt = 1920;
    const web = new ElectronWebApp(sized, win);
    const wc = fake.views.at(-1)!;
    web.show();
    const other = new fake.FakeContents();
    expect(wc.zoom).toBeGreaterThan(1);
    expect(other.zoom).toBe(1);
    expect(other.zoomCalls).toEqual([]);
  });

  test("a disposed host no longer zooms on a resize", () => {
    const web = new ElectronWebApp(sized, win);
    const wc = fake.views.at(-1)!;
    web.dispose();
    const before = wc.zoomCalls.length;
    resize(1920);
    expect(wc.zoomCalls.length).toBe(before);
  });

  test("an open search bar is redrawn at the new zoom when the zoom changes", () => {
    const web = new ElectronWebApp(sized, win);
    const wc = fake.views.at(-1)!;
    web.showSearchBar("abc");
    wc.scripts.length = 0;
    web.setTextSize("larger");
    expect(wc.scripts.some((s) => s.includes("couch-search") && s.includes('"abc"'))).toBe(true);
  });

  test("no search bar is redrawn when none is open", () => {
    const web = new ElectronWebApp(sized, win);
    const wc = fake.views.at(-1)!;
    wc.scripts.length = 0;
    web.setTextSize("larger");
    expect(wc.scripts.some((s) => s.includes("couch-search"))).toBe(false);
  });
});
