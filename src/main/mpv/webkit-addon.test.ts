import { describe, expect, test } from "vite-plus/test";
import type { WebKitEvent } from "../web/webkit-bridge.ts";
import { webkitStoreId } from "../web/webkit-bridge.ts";
import { createWebKitBridge, type WebKitAddon } from "./embed-addon.ts";

type Callback = (kind: string, a: string, b: string) => void;

function fakeAddon() {
  const calls: unknown[][] = [];
  let callback: Callback = () => {};
  const addon: WebKitAddon = {
    webkitSupported: () => true,
    webkitUserAgent: () => "Safari UA",
    webkitCreate: (handle, storeId, userAgent, cb) => {
      calls.push(["create", handle, storeId, userAgent]);
      callback = cb;
      return 7;
    },
    webkitLoad: (id, url) => calls.push(["load", id, url]),
    webkitEvaluate: (id, script, cb) => {
      calls.push(["evaluate", id, script]);
      if (script === "boom") cb("SyntaxError", "");
      else cb(null, JSON.stringify([script === "two" ? 2 : { a: 1 }]));
    },
    webkitAddUserScript: (id, source) => calls.push(["script", id, source]),
    webkitAddMessageHandler: (id, name) => calls.push(["handler", id, name]),
    webkitSetFrame: (id, x, y, w, h) => calls.push(["frame", id, x, y, w, h]),
    webkitSetVisible: (id, v) => calls.push(["visible", id, v]),
    webkitFocus: (id) => calls.push(["focus", id]),
    webkitSendKey: (id, key, down) => calls.push(["key", id, key, down]),
    webkitDestroy: (id) => calls.push(["destroy", id]),
  };
  return { addon, calls, fire: (k: string, a = "", b = "") => callback(k, a, b) };
}

const window = { isDestroyed: () => false, getNativeWindowHandle: () => Buffer.from("handle") };

describe("the WebKit bridge over the native add-on", () => {
  test("is unavailable without WebKit support or a window", () => {
    const f = fakeAddon();
    f.addon.webkitSupported = () => false;
    expect(
      createWebKitBridge(
        () => window as any,
        () => f.addon,
      ),
    ).toBeUndefined();
    expect(
      createWebKitBridge(
        () => window as any,
        () => ({ nope: 1 }) as any,
      ),
    ).toBeUndefined();
  });

  test("a view is created in the window with its store and Safari's user agent", () => {
    const f = fakeAddon();
    const bridge = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!;
    expect(bridge.userAgent()).toBe("Safari UA");
    bridge.create({ storeId: webkitStoreId("netflix"), userAgent: "UA" });
    expect(f.calls[0]).toEqual([
      "create",
      window.getNativeWindowHandle(),
      webkitStoreId("netflix"),
      "UA",
    ]);
  });

  test("calls reach the view by its id", () => {
    const f = fakeAddon();
    const view = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ storeId: "s", userAgent: "u" });
    view.load("https://x.test/");
    view.addUserScript("js");
    view.addMessageHandler("couch");
    view.setFrame(0, 0, 10, 20);
    view.setVisible(true);
    view.focus();
    view.sendKey("Return", true);
    view.destroy();
    expect(f.calls.slice(1)).toEqual([
      ["load", 7, "https://x.test/"],
      ["script", 7, "js"],
      ["handler", 7, "couch"],
      ["frame", 7, 0, 0, 10, 20],
      ["visible", 7, true],
      ["focus", 7],
      ["key", 7, "Return", true],
      ["destroy", 7],
    ]);
  });

  test("evaluate resolves to the parsed value and rejects on an error", async () => {
    const f = fakeAddon();
    const view = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ storeId: "s", userAgent: "u" });
    await expect(view.evaluate("two")).resolves.toBe(2);
    await expect(view.evaluate("x")).resolves.toEqual({ a: 1 });
    await expect(view.evaluate("boom")).rejects.toThrow("SyntaxError");
  });

  test("native events become WebKit events", () => {
    const f = fakeAddon();
    const view = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ storeId: "s", userAgent: "u" });
    const seen: WebKitEvent[] = [];
    const stop = view.onEvent((e) => seen.push(e));
    f.fire("message", "couch", JSON.stringify({ type: "route" }));
    f.fire("loaded", "https://a/");
    f.fire("navigated", "https://b/");
    f.fire("failed", "offline");
    stop();
    f.fire("loaded", "https://c/");
    expect(seen).toEqual([
      { type: "message", name: "couch", body: { type: "route" } },
      { type: "loaded", url: "https://a/" },
      { type: "navigated", url: "https://b/" },
      { type: "failed", error: "offline" },
    ]);
  });
});

describe("webkitStoreId", () => {
  test("is a stable UUID per App and differs between Apps", () => {
    expect(webkitStoreId("netflix")).toBe(webkitStoreId("netflix"));
    expect(webkitStoreId("netflix")).not.toBe(webkitStoreId("youtube"));
    expect(webkitStoreId("netflix")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
