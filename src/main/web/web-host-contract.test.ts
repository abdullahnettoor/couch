import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, vi } from "vite-plus/test";

const fake = vi.hoisted(() => {
  class FakeContents {
    url = "about:blank";
    entries: Array<{ url: string }> = [];
    active = 0;
    handlers = new Map<string, Array<(...args: any[]) => void>>();
    scripts: string[] = [];
    loads: string[] = [];
    inputs: Array<{ type: string; keyCode: string }> = [];
    answers: Array<[string, unknown]> = [];
    failing = false;
    debugger = {
      isAttached: () => true,
      attach: () => {},
      on: () => {},
      sendCommand: async () => ({}),
    };
    navigationHistory = {
      getAllEntries: () => this.entries,
      getActiveIndex: () => this.active,
    };
    on(event: string, fn: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
      return this;
    }
    once(event: string, fn: (...args: any[]) => void) {
      return this.on(event, fn);
    }
    emit(event: string, ...args: any[]) {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
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
    async executeJavaScript(script: string) {
      this.scripts.push(script);
      if (this.failing) throw new Error("page script failed");
      for (const [part, answer] of this.answers) if (script.includes(part)) return answer;
      return undefined;
    }
    sendInputEvent(event: { type: string; keyCode: string }) {
      this.inputs.push(event);
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
  const preloadFiles: string[] = [];
  /** The userData folder of the test running now: preload files are written under it, so no two tests share one. */
  const state = { userData: "" };
  return { FakeContents, views, preloadFiles, state };
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
    registerPreloadScript: (script: { filePath: string }) => {
      fake.preloadFiles.push(script.filePath);
      return "id";
    },
    unregisterPreloadScript() {},
  };
  return {
    app: { getPath: () => fake.state.userData, focus() {} },
    BrowserWindow: class {},
    WebContentsView,
    clipboard: { readText: () => "" },
    components: { whenReady: async () => {} },
    session: { fromPartition: () => session },
  };
});

import type { YouTubeEvent } from "../ports/youtube.ts";
import { COUCH_HOST_CONSOLE, COUCH_HOST_WEBKIT } from "./couch-host.ts";
import { ElectronWebApp } from "./electron-web-app.ts";
import { describeWebHostContract, type HostRig } from "./web-host-contract.ts";
import { MEDIA_TOGGLE_SCRIPT } from "./media-toggle.ts";
import type { WebAppDescription } from "./web-app.ts";
import type { EvaluateKind, WebKitBridge, WebKitEvent, WebKitView } from "./webkit-bridge.ts";
import { WebKitWebApp } from "./webkit-web-app.ts";

const electronWindow: any = {
  contentView: { addChildView() {}, removeChildView() {} },
  on() {},
  off() {},
  getContentBounds: () => ({ width: 1280, height: 720 }),
  isDestroyed: () => true,
  webContents: { focus() {} },
};

function electronRig(description: WebAppDescription): HostRig {
  const host = new ElectronWebApp(description, electronWindow);
  const contents = fake.views.at(-1)!;
  const events: YouTubeEvent[] = [];
  host.onEvent((e) => events.push(e));
  return {
    host,
    events,
    show: async () => {
      host.show();
      await vi.waitFor(() => expect(contents.loads.some((u) => u !== "about:blank")).toBe(true));
    },
    dispose: () => host.dispose(),
    playPauseDelivered: () => contents.inputs.some((i) => i.keyCode === "MediaPlayPause"),
    answer: (part, value) => void contents.answers.push([part, value]),
    failScripts: () => void (contents.failing = true),
    scripts: () => contents.scripts,
    keys: () => contents.inputs.filter((i) => i.type === "keyDown").map((i) => i.keyCode),
    navigate: (url) => {
      contents.url = url;
      contents.emit("did-navigate-in-page", {}, url);
    },
    loads: () => contents.loads,
    navigateTop: (url, kind) => {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      contents.emit(kind === "redirect" ? "will-redirect" : "will-navigate", event, url);
      return !event.defaultPrevented;
    },
    loaded: () => {
      contents.emit("dom-ready");
      contents.emit("did-finish-load");
    },
    allowHistoryBack: () => {
      contents.entries = [
        { url: "https://www.netflix.com/browse" },
        { url: "https://www.netflix.com/watch/1" },
      ];
      contents.active = 1;
    },
    installed: () => readFileSync(fake.preloadFiles.at(-1)!, "utf8"),
    hidesScrollbars: () => contents.css.some((c) => c.includes("scrollbar-width")),
    pageMouseDown: () => contents.emit("before-mouse-event", {}, { type: "mouseDown" }),
    couchSend: (message, frame = { main: true, origin: "https://www.netflix.com" }) => {
      const sandbox: any = {
        console: {
          debug: (line: string) =>
            contents.emit("console-message", {
              message: line,
              frame: { parent: frame.main ? null : {}, origin: frame.origin },
            }),
        },
      };
      sandbox.window = sandbox;
      vm.runInNewContext(`(${COUCH_HOST_CONSOLE})()`, sandbox);
      sandbox.couchHost.send(message);
    },
  };
}

class FakeWebKitView implements WebKitView {
  scripts: string[] = [];
  loads: string[] = [];
  keys: Array<[string, boolean]> = [];
  answers: Array<[string, unknown]> = [];
  failing = false;
  listeners = new Set<(e: WebKitEvent) => void>();
  load(url: string) {
    this.loads.push(url);
  }
  async setCookies() {}
  async evaluate(script: string, _options: { kind: EvaluateKind }) {
    this.scripts.push(script);
    if (this.failing) throw new Error("page script failed");
    for (const [part, answer] of this.answers) if (script.includes(part)) return answer;
    return undefined;
  }
  userScripts: string[] = [];
  addUserScript(source: string) {
    this.userScripts.push(source);
  }
  setUserScript() {}
  addMessageHandler() {}
  setFrame() {}
  setVisible() {}
  focus() {}
  answerKey() {}
  wakePointer() {}
  setInputRouting() {}
  guard = false;
  setNavigationGuard(on: boolean) {
    this.guard = on;
  }
  decisions = new Map<number, boolean>();
  answerNavigation(id: number, allow: boolean) {
    this.decisions.set(id, allow);
  }
  /** What the native delegate does: with its guard on, it asks the host (event `navigating`) and waits for the answer. */
  attempt(url: string): boolean {
    if (!this.guard) return true;
    const id = this.decisions.size + 1;
    for (const l of Array.from(this.listeners)) l({ type: "navigating", id, url });
    return this.decisions.get(id) ?? false;
  }
  sendKey(key: string, down: boolean) {
    this.keys.push([key, down]);
  }
  onEvent(l: (e: WebKitEvent) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  destroy() {}
}

function webkitRig(description: WebAppDescription): HostRig {
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
  const events: YouTubeEvent[] = [];
  host.onEvent((e) => events.push(e));
  return {
    host,
    events,
    show: async () => host.show(),
    dispose: () => host.dispose(),
    playPauseDelivered: () => view.scripts.includes(MEDIA_TOGGLE_SCRIPT),
    answer: (part, value) => void view.answers.push([part, value]),
    failScripts: () => void (view.failing = true),
    scripts: () => view.scripts,
    keys: () => view.keys.filter(([, down]) => down).map(([key]) => key),
    navigate: (url) => {
      for (const l of Array.from(view.listeners)) l({ type: "navigated", url });
    },
    loads: () => view.loads,
    navigateTop: (url) => view.attempt(url),
    loaded: () => {
      for (const l of Array.from(view.listeners))
        l({ type: "loaded", url: "https://www.netflix.com/browse" });
    },
    allowHistoryBack: () => void view.answers.push(["__couchCanGoBack", true]),
    couchSend: (message, frame = { main: true, origin: "https://www.netflix.com" }) => {
      const sandbox: any = {
        webkit: {
          messageHandlers: {
            couch: {
              postMessage: (body: unknown) => {
                for (const l of Array.from(view.listeners))
                  l({
                    type: "message",
                    name: "couch",
                    body,
                    frame: { isMainFrame: frame.main, origin: frame.origin },
                  });
              },
            },
          },
        },
      };
      sandbox.window = sandbox;
      vm.runInNewContext(`(${COUCH_HOST_WEBKIT})()`, sandbox);
      sandbox.couchHost.send(message);
    },
    installed: () => view.userScripts.join("\n"),
    hidesScrollbars: () => view.userScripts.some((c) => c.includes("scrollbar-width")),
    pageMouseDown: () => {
      for (const l of Array.from(view.listeners))
        l({
          type: "message",
          name: "couch",
          body: { type: "input" },
          frame: { isMainFrame: true, origin: "https://www.netflix.com" },
        });
    },
  };
}

beforeEach(() => {
  fake.views.length = 0;
  fake.preloadFiles.length = 0;
  fake.state.userData = mkdtempSync(join(tmpdir(), "couch-contract-"));
});

afterEach(() => {
  rmSync(fake.state.userData, { recursive: true, force: true });
});

describeWebHostContract("ElectronWebApp on fake WebContents", electronRig);
describeWebHostContract("WebKitWebApp on the fake bridge", webkitRig);
