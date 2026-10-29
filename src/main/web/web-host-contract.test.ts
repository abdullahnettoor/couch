import { tmpdir } from "node:os";
import { beforeEach, expect, vi } from "vite-plus/test";

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
    async insertCSS() {
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

import type { YouTubeEvent } from "../ports/youtube.ts";
import { ElectronWebApp } from "./electron-web-app.ts";
import { contractDescription, describeWebHostContract, type HostRig } from "./web-host-contract.ts";
import type { EvaluateKind, WebKitBridge, WebKitEvent, WebKitView } from "./webkit-bridge.ts";
import { WebKitWebApp } from "./webkit-web-app.ts";

const electronWindow: any = {
  contentView: { addChildView() {}, removeChildView() {} },
  on() {},
  getContentBounds: () => ({ width: 1280, height: 720 }),
  isDestroyed: () => true,
  webContents: { focus() {} },
};

function electronRig(): HostRig {
  const host = new ElectronWebApp(contractDescription, electronWindow);
  const contents = fake.views.at(-1)!;
  const events: YouTubeEvent[] = [];
  host.onEvent((e) => events.push(e));
  return {
    host,
    events,
    show: async () => {
      host.show();
      await vi.waitFor(() => expect(contents.loads).toContain(contractDescription.url));
    },
    answer: (part, value) => void contents.answers.push([part, value]),
    failScripts: () => void (contents.failing = true),
    scripts: () => contents.scripts,
    keys: () => contents.inputs.filter((i) => i.type === "keyDown").map((i) => i.keyCode),
    navigate: (url) => {
      contents.url = url;
      contents.emit("did-navigate-in-page", {}, url);
    },
    loads: () => contents.loads,
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
  addUserScript() {}
  setUserScript() {}
  addMessageHandler() {}
  setFrame() {}
  setVisible() {}
  focus() {}
  sendKey(key: string, down: boolean) {
    this.keys.push([key, down]);
  }
  onEvent(l: (e: WebKitEvent) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  destroy() {}
}

function webkitRig(): HostRig {
  const view = new FakeWebKitView();
  const bridge: WebKitBridge = {
    userAgent: () => "Safari UA",
    create: () => view,
    removeStore: async () => {},
  };
  const host = new WebKitWebApp(
    contractDescription,
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
    answer: (part, value) => void view.answers.push([part, value]),
    failScripts: () => void (view.failing = true),
    scripts: () => view.scripts,
    keys: () => view.keys.filter(([, down]) => down).map(([key]) => key),
    navigate: (url) => {
      for (const l of Array.from(view.listeners)) l({ type: "navigated", url });
    },
    loads: () => view.loads,
    loaded: () => {
      for (const l of Array.from(view.listeners))
        l({ type: "loaded", url: "https://www.netflix.com/browse" });
    },
    allowHistoryBack: () => {},
  };
}

beforeEach(() => {
  fake.views.length = 0;
});

describeWebHostContract("ElectronWebApp on fake WebContents", electronRig);
describeWebHostContract("WebKitWebApp on the fake bridge", webkitRig);
