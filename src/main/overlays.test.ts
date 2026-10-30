import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const fake = vi.hoisted(() => {
  class FakeContents {
    url = "about:blank";
    handlers = new Map<string, Array<(...args: any[]) => void>>();
    scripts: string[] = [];
    loads: string[] = [];
    reloads = 0;
    closed = 0;
    debugger = {
      isAttached: () => true,
      attach: () => {},
      on: () => {},
      sendCommand: async () => ({}),
    };
    navigationHistory = { getAllEntries: () => [], getActiveIndex: () => 0 };
    on(event: string, fn: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
      return this;
    }
    once(event: string, fn: (...args: any[]) => void) {
      return this.on(event, fn);
    }
    getURL() {
      return this.url;
    }
    isLoading() {
      return false;
    }
    async loadURL(url: string) {
      this.loads.push(url);
      this.url = url;
    }
    answers: Array<[string, unknown]> = [];
    async executeJavaScript(script: string) {
      this.scripts.push(script);
      for (const [part, answer] of this.answers) if (script.includes(part)) return answer;
      return undefined;
    }
    sendInputEvent() {}
    setUserAgent() {}
    setAudioMuted() {}
    async insertCSS() {
      return "key";
    }
    focus() {}
    close() {
      this.closed++;
    }
    reload() {
      this.reloads++;
    }
  }
  const views: FakeContents[] = [];
  /** Visibility and size changes made to the App's view, in order. */
  const layout: string[] = [];
  return { FakeContents, views, layout };
});

vi.mock("electron", () => {
  class WebContentsView {
    webContents = new fake.FakeContents();
    constructor() {
      fake.views.push(this.webContents);
    }
    setVisible(v: boolean) {
      fake.layout.push(`visible:${v}`);
    }
    setBounds() {
      fake.layout.push("bounds");
    }
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

import { netflixDescription } from "./apps/netflix/netflix-web.ts";
import { NetflixApp } from "./apps/netflix/netflix-app.ts";
import { FakeClock } from "./ports/fakes.ts";
import type { YouTube } from "./ports/youtube.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";
import { ElectronWebApp } from "./web/electron-web-app.ts";
import { PictureCover, type CoverView } from "./web/picture-cover.ts";
import type { EvaluateKind, WebKitBridge, WebKitEvent, WebKitView } from "./web/webkit-bridge.ts";
import { WebKitWebApp } from "./web/webkit-web-app.ts";

const description = netflixDescription("130.0.0.0");
const playing = { position: 30, duration: 600, paused: false, title: "Test Pattern" };

/** What the shared overlay suite needs of an engine's rig: the host, and how to see it was left alone. */
interface OverlayRig {
  host: YouTube;
  /** Waits for the host's first show to have reached the page. */
  shown(): Promise<void>;
  /** The page starts playing; resolves once the host has told Couch. */
  play(): void;
  /** Every script the host ran in the page. */
  scripts(): string[];
  /** Everything done to the page since it was shown that an overlay must never do. */
  disturbed(): string[];
  /** True when the page's own view is still visible. */
  visible(): boolean;
  /** Whether the host draws the volume and questions itself, in the page (Chromium) or leaves them to Couch's screen (WebKit). */
  drawsHud: boolean;
}

const win: any = {
  contentView: { addChildView() {}, removeChildView() {} },
  on() {},
  getContentBounds: () => ({ width: 1280, height: 720 }),
  isDestroyed: () => true,
  webContents: { focus() {} },
};

function electronRig(): OverlayRig {
  const host = new ElectronWebApp(description, win);
  const contents = fake.views.at(-1)!;
  let baseline = { scripts: 0, loads: 0, layout: 0 };
  const pauses = () => contents.scripts.slice(baseline.scripts).filter((s) => /pause\(\)/.test(s));
  return {
    host,
    drawsHud: true,
    scripts: () => contents.scripts,
    play: () => void contents.answers.push(['querySelectorAll("video")', playing]),
    shown: async () => {
      host.show();
      await vi.waitFor(() => expect(contents.loads).toContain(description.url));
      contents.url = "https://www.netflix.com/browse";
      baseline = {
        scripts: contents.scripts.length,
        loads: contents.loads.length,
        layout: fake.layout.length,
      };
    },
    visible: () => fake.layout.filter((l) => l.startsWith("visible")).at(-1) !== "visible:false",
    disturbed: () => [
      ...fake.layout.slice(baseline.layout).map((l) => `view ${l}`),
      ...contents.loads.slice(baseline.loads).map((u) => `load ${u}`),
      ...pauses().map(() => "pause"),
      ...Array(contents.reloads).fill("reload"),
      ...Array(contents.closed).fill("close"),
    ],
  };
}

class FakeWebKitView implements WebKitView {
  scripts: string[] = [];
  loads: string[] = [];
  frames = 0;
  visibility: boolean[] = [];
  destroyed = false;
  listeners = new Set<(e: WebKitEvent) => void>();
  load(url: string) {
    this.loads.push(url);
  }
  async setCookies() {}
  answers: Array<[string, unknown]> = [];
  async evaluate(script: string, _options: { kind: EvaluateKind }) {
    this.scripts.push(script);
    for (const [part, answer] of this.answers) if (script.includes(part)) return answer;
    return undefined;
  }
  addUserScript() {}
  setUserScript() {}
  addMessageHandler() {}
  setFrame() {
    this.frames++;
  }
  setVisible(v: boolean) {
    this.visibility.push(v);
  }
  focus() {}
  sendKey() {}
  answerKey() {}
  wakePointer() {}
  setNavigationGuard() {}
  answerNavigation() {}
  setInputRouting() {}
  onEvent(l: (e: WebKitEvent) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  destroy() {
    this.destroyed = true;
  }
}

function webkitRig(): OverlayRig {
  const view = new FakeWebKitView();
  const bridge: WebKitBridge = {
    userAgent: () => "Safari UA",
    create: () => view,
    removeStore: async () => {},
  };
  const host = new WebKitWebApp(
    description,
    bridge,
    {
      getContentBounds: () => ({ width: 1280, height: 720 }),
      onResize() {},
      reveal: async () => {},
    },
    { ephemeral: true },
  );
  let baseline = { scripts: 0, loads: 0, frames: 0, visibility: 0 };
  return {
    host,
    drawsHud: false,
    scripts: () => view.scripts,
    play: () => void view.answers.push(['querySelectorAll("video")', playing]),
    shown: async () => {
      host.show();
      baseline = {
        scripts: view.scripts.length,
        loads: view.loads.length,
        frames: view.frames,
        visibility: view.visibility.length,
      };
    },
    visible: () => view.visibility.at(-1) !== false,
    disturbed: () => [
      ...view.visibility.slice(baseline.visibility).map((v) => `visible:${v}`),
      ...(view.frames > baseline.frames ? ["resize"] : []),
      ...view.loads.slice(baseline.loads).map((u) => `load ${u}`),
      ...view.scripts.slice(baseline.scripts).filter((s) => /pause\(\)|location\.reload/.test(s)),
      ...(view.destroyed ? ["destroyed"] : []),
    ],
  };
}

/** A stand-in for Chromium's cover view: records whether it is last in the window's stack. */
class CoverFake implements CoverView {
  webContents = {
    executeJavaScript: () => Promise.resolve(),
    loadURL: () => Promise.resolve(),
    on: () => {},
    focus: () => {},
  };
  setBounds() {}
}

class OverlayNetflix extends NetflixApp {
  constructor(port: YouTube, clock: FakeClock) {
    super(port, clock);
    Object.defineProperty(this, "id", { value: "nf2" });
  }
}

let h: Harness;
let phone: FakePhone;
let clock: FakeClock;
let stack: unknown[];
let cover: CoverFake;
const entry = {
  id: "nf2",
  label: "Netflix",
  icon: "<svg></svg>",
  action: "app:open:nf2",
  web: true,
};

beforeEach(() => {
  fake.views.length = 0;
  fake.layout.length = 0;
});
afterEach(() => h.stop());

async function compose(rig: OverlayRig) {
  clock = new FakeClock();
  h = await startHarness(undefined, {
    apps: [{ entry, app: new OverlayNetflix(rig.host, clock) }],
  });
  phone = await h.connectPhone();
  stack = [];
  cover = new CoverFake();
  const picture = new PictureCover<CoverFake>(
    {
      contentView: {
        children: stack,
        addChildView: (v) => {
          const i = stack.indexOf(v);
          if (i >= 0) stack.splice(i, 1);
          stack.push(v);
        },
        removeChildView: (v) => {
          const i = stack.indexOf(v);
          if (i >= 0) stack.splice(i, 1);
        },
      },
      getContentBounds: () => ({ width: 1280, height: 720 }),
    },
    () => cover,
    (command) => h.app.screenCommand(command),
  );
  // The same wiring index.ts does on every screen change.
  h.app.onScreen((p) => picture.set(p.state.pictureOff && p.state.view === "app"));
  for (let i = 0; i < 20 && h.screen.last.focusedId !== "nf2"; i++) {
    const { grid, focusedId } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === "nf2")!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  await phone.press("ok");
  await rig.shown();
  rig.play();
  await phone.waitFor(() => phone.last?.nowPlaying !== undefined, 5000);
}

function describeOverlays(name: string, makeRig: () => OverlayRig): void {
  describe(`overlays over a playing page: ${name}`, () => {
    let rig: OverlayRig;
    const screen = () => h.screen.last;
    const coverOn = () => stack.at(-1) === cover;
    const quiet = () => {
      expect(rig.visible()).toBe(true);
      expect(rig.disturbed()).toEqual([]);
    };

    beforeEach(async () => {
      rig = makeRig();
      await compose(rig);
      expect(screen().state.view).toBe("app");
    });

    test("nothing has touched the page yet", () => {
      expect(coverOn()).toBe(false);
      expect(screen().quick).toBeUndefined();
      quiet();
    });

    test("the check itself notices a page that is hidden", () => {
      rig.host.hide();
      expect(rig.visible()).toBe(false);
      expect(rig.disturbed().length).toBeGreaterThan(0);
    });

    test("Picture off covers the page and lifts again, and the page is left alone both ways", async () => {
      await phone.press({ command: "setPictureOff", args: { on: true } });
      expect(screen().state.pictureOff).toBe(true);
      expect(coverOn()).toBe(true);
      quiet();
      await phone.press({ command: "setPictureOff", args: { on: false } });
      expect(screen().state.pictureOff).toBe(false);
      expect(coverOn()).toBe(false);
      expect(stack).not.toContain(cover);
      quiet();
    });

    test("Quick settings opens and closes over the page, and the page is left alone", async () => {
      await phone.press("quickSettings");
      expect(screen().quick).toBeDefined();
      expect(phone.last?.quickSettings).toBe(true);
      quiet();
      h.app.screenCommand({ command: "quickClose" });
      expect(screen().quick).toBeUndefined();
      quiet();
    });

    test("Quick settings and Picture off together, closed in the other order", async () => {
      await phone.press({ command: "setPictureOff", args: { on: true } });
      await phone.press("quickSettings");
      expect(coverOn()).toBe(true);
      expect(screen().quick).toBeDefined();
      quiet();
      h.app.screenCommand({ command: "quickClose" });
      await phone.press({ command: "setPictureOff", args: { on: false } });
      expect(coverOn()).toBe(false);
      expect(screen().quick).toBeUndefined();
      quiet();
    });

    test("the volume display shows and clears; only a Chromium host draws it in the page", async () => {
      const before = rig.scripts().length;
      await phone.press("volUp");
      expect(screen().state.volumeShown).toBe(true);
      quiet();
      const injected = rig
        .scripts()
        .slice(before)
        .filter((x) => x.includes("couch-volume"));
      expect(injected.length > 0).toBe(rig.drawsHud);
      h.clock.advance(3000);
      expect(screen().state.volumeShown).toBe(false);
      quiet();
    });

    test('"Leave Netflix?" shows over the page and is answered, leaving the page alone', async () => {
      await phone.press("back");
      expect(screen().state.confirm?.title).toBe("Leave Netflix?");
      expect(screen().state.view).toBe("app");
      quiet();
      h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
      expect(screen().state.confirm).toBeUndefined();
      expect(screen().state.view).toBe("app");
      quiet();
    });

    test("the search bar opens and closes, and the page is left alone", async () => {
      await phone.press({ command: "typeOpen" });
      await phone.press({ command: "typeText", args: { text: "dark" } });
      expect(phone.last?.typing).toBe("you");
      expect(rig.scripts().some((x) => x.includes("couch-search") && x.includes("dark"))).toBe(
        true,
      );
      quiet();
      await phone.press("typeCancel");
      expect(phone.last?.typing).toBe("none");
      quiet();
    });
  });
}

describeOverlays("ElectronWebApp on fake WebContents", electronRig);
describeOverlays("WebKitWebApp on the fake bridge", webkitRig);
