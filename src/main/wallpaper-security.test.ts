import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const sessions = vi.hoisted(() => ({
  before: [] as Array<(d: any, cb: (r: any) => void) => void>,
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
  const makeSession = () => ({
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
    session: { fromPartition: () => makeSession() },
  };
});

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { netflixDescription } from "./apps/netflix/netflix-web.ts";
import { youtubeDescription } from "./apps/youtube/youtube-web.ts";
import { FileStore } from "./ports/store.ts";
import { parseCommand } from "./remote/server.ts";
import { ElectronWebApp } from "./web/electron-web-app.ts";
import { startHarness, type Harness } from "./testing/harness.ts";
import { MAX_PHOTO_DATA } from "../shared/wallpapers.ts";

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

  test("data longer than 3 MB of base64 is dropped, and non-strings too", () => {
    expect(
      parseCommand(raw("addPhoto", { data: "A".repeat(MAX_PHOTO_DATA + 1) }))?.args?.data,
    ).toBeUndefined();
    expect(parseCommand(raw("addPhoto", { data: 42 }))?.args?.data).toBeUndefined();
  });
});
