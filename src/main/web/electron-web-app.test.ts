import { tmpdir } from "node:os";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

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
  }
  const views: FakeContents[] = [];
  return { FakeContents, views };
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
  const session = {
    setUserAgent() {},
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {}, onBeforeSendHeaders() {} },
    registerPreloadScript: () => "id",
    unregisterPreloadScript() {},
  };
  return {
    app: { getPath: () => tmpdir(), focus() {} },
    BrowserWindow: class {},
    WebContentsView,
    clipboard: { readText: () => "" },
    components: { whenReady: async () => {} },
    session: { fromPartition: () => session },
  };
});

import { netflixDescription } from "../apps/netflix/netflix-web.ts";
import { youtubeDescription } from "../apps/youtube/youtube-web.ts";
import { ElectronWebApp } from "./electron-web-app.ts";
import { HIDE_SCROLLBARS_CSS } from "./hide-scrollbars.ts";

const win: any = {
  contentView: { addChildView() {}, removeChildView() {} },
  on() {},
  getContentBounds: () => ({ width: 1280, height: 720 }),
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
