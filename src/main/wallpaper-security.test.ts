import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const sessions = vi.hoisted(() => ({
  before: [] as Array<(d: any, cb: (r: any) => void) => void>,
  byPartition: new Map<string, any>(),
}));

vi.mock("electron", () => {
  const noop = () => {};
  const contents = new Proxy(
    {},
    {
      get: (_t, k) => (k === "debugger" ? { isAttached: () => false, on: noop } : noop),
    },
  );
  class WebContentsView {
    webContents = contents;
    setVisible() {}
    setBounds() {}
  }
  const makeSession = (): any => ({
    setUserAgent() {},
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    webRequest: {
      onBeforeRequest: (l: any) => sessions.before.push(l),
      onBeforeSendHeaders() {},
    },
    registerPreloadScript: () => "id",
    unregisterPreloadScript() {},
  });
  return {
    app: { getPath: () => tmpdir(), focus() {} },
    BrowserWindow: class {},
    WebContentsView,
    clipboard: { readText: () => "" },
    components: { whenReady: async () => {} },
    session: {
      fromPartition: (name: string) => {
        if (!sessions.byPartition.has(name)) sessions.byPartition.set(name, makeSession());
        return sessions.byPartition.get(name);
      },
    },
  };
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { session } from "electron";
import { join } from "node:path";
import { netflixDescription } from "./apps/netflix/netflix-web.ts";
import { youtubeDescription } from "./apps/youtube/youtube-web.ts";
import { FileStore } from "./ports/store.ts";
import { MAX_MESSAGE, parseCommand } from "./remote/server.ts";
import { ElectronWebApp } from "./web/electron-web-app.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

const win: any = {
  contentView: { addChildView() {}, removeChildView() {} },
  on() {},
  getContentBounds: () => ({ width: 1280, height: 720 }),
  isDestroyed: () => true,
  webContents: { focus() {} },
};
const WALLPAPER_URL =
  "file:///Users/me/Library/Application%20Support/Couch/wallpapers/0123456789ab.jpg";
const ask = (listener: (d: any, cb: (r: any) => void) => void, url: string) =>
  new Promise<any>((res) => listener({ url }, res));

describe("web App sessions can't reach the wallpaper photo", () => {
  test("every App's session cancels file: requests, and lets https ones through", async () => {
    sessions.before.length = 0;
    sessions.byPartition.clear();
    new ElectronWebApp(netflixDescription("130.0.0.0"), win);
    new ElectronWebApp(youtubeDescription("130.0.0.0"), win);
    expect(sessions.before).toHaveLength(2);
    for (const listener of sessions.before) {
      expect(await ask(listener, WALLPAPER_URL)).toEqual({ cancel: true });
      expect(await ask(listener, WALLPAPER_URL.replace("file:", "FILE:"))).toEqual({
        cancel: true,
      });
      expect(await ask(listener, "https://www.netflix.com/browse")).toEqual({});
    }
  });
});

describe("the mocked session", () => {
  test("is one object per partition, like Electron's", () => {
    expect(session.fromPartition("persist:youtube")).toBe(session.fromPartition("persist:youtube"));
    expect(session.fromPartition("persist:youtube")).not.toBe(session.fromPartition("persist:x"));
  });

  test("an App holds the same session object it was built on", async () => {
    sessions.before.length = 0;
    sessions.byPartition.clear();
    new ElectronWebApp(youtubeDescription("130.0.0.0"), win);
    expect(sessions.before).toHaveLength(1);
    const held = session.fromPartition("persist:youtube") as any;
    expect(sessions.byPartition.size).toBe(1);
    expect(held.webRequest.onBeforeRequest).toBeDefined();
    expect(await ask(sessions.before[0]!, WALLPAPER_URL)).toEqual({ cancel: true });
  });
});

describe("the Screen's CSP", () => {
  const html = readFileSync(join(import.meta.dirname, "../renderer/index.html"), "utf8");
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1]!;
  const sources = (directive: string) =>
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .find(([name]) => name === directive)
      ?.slice(1) ?? [];

  test("lets the Screen load the wallpaper's file: URL as an image", () => {
    expect(sources("img-src")).toContain("file:");
    expect(WALLPAPER_URL.startsWith("file:")).toBe(true);
  });

  test("and scripts only from the page itself", () => {
    expect(sources("default-src")).toEqual(["'self'"]);
    expect(sources("script-src")).toEqual([]);
  });
});

describe("the photo is not on the network", () => {
  let h: Harness | undefined;
  let dir = "";
  afterEach(async () => {
    await h?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
    h = undefined;
  });

  test("the Remote server serves no wallpaper path, with or without the key", async () => {
    dir = mkdtempSync(join(tmpdir(), "couch-sec-"));
    h = await startHarness(new FileStore(dir));
    const phone = await h.connectPhone();
    await phone.press("up");
    await phone.press("ok");
    for (let i = 0; i < 12 && h.screen.last.focusedLabel !== "Home"; i++) await phone.press("down");
    await phone.press("ok");
    await phone.press({
      command: "addPhoto",
      args: { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 128]).toString("base64") },
    });
    const id = h.screen.last.home!.photos![0]!.id;
    const base = `http://127.0.0.1:${h.app.remote.port}`;
    const key = h.pairingKey();
    for (const path of [
      `/wallpapers/${id}.jpg`,
      `/wallpapers/${id}.jpg?key=${key}`,
      `/thumb/${id}.jpg?key=${key}`,
      `/thumb/../wallpapers/${id}.jpg?key=${key}`,
      `/${id}.jpg`,
    ]) {
      const res = await fetch(base + path);
      expect(res.status, path).toBeGreaterThanOrEqual(401);
      expect(res.headers.get("content-type") ?? "", path).not.toContain("image");
    }
  });
});

describe("the addPhoto command on the wire", () => {
  const raw = (command: string, args: unknown) =>
    JSON.stringify({ type: "command", command, args });

  test("carries its data, and only that command does", () => {
    expect(parseCommand(raw("addPhoto", { data: "AAEC" }))).toEqual({
      command: "addPhoto",
      args: { data: "AAEC" },
    });
    expect(parseCommand(raw("typeText", { data: "AAEC" }))?.args?.data).toBeUndefined();
  });

  test("data past the transport ceiling is refused, and non-strings too", () => {
    expect(parseCommand(raw("addPhoto", { data: "A".repeat(MAX_MESSAGE + 1) }))).toBeUndefined();
    expect(parseCommand(raw("addPhoto", { data: 42 }))).toBeUndefined();
  });
});
