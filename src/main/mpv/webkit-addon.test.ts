import { describe, expect, test } from "vite-plus/test";
import type { WebKitEvent } from "../web/webkit-bridge.ts";
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
    webkitEvaluate: (id, script, kind, cb) => {
      calls.push(["evaluate", id, script, kind]);
      if (script === "boom") cb("SyntaxError", "");
      else cb(null, JSON.stringify([script === "two" ? 2 : { a: 1 }]));
    },
    webkitAddUserScript: (id, source, world) => calls.push(["script", id, source, world]),
    webkitRemoveStore: (storeId, cb) => {
      calls.push(["removeStore", storeId]);
      cb(storeId === "busy" ? "in use" : null);
    },
    webkitSetCookies: (id, json, cb) => {
      calls.push(["cookies", id, json]);
      cb(json.includes("refuse") ? "refused" : null);
    },
    webkitListCookies: (_id, cb) => cb(null, "[[]]"),
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
    bridge.create({ store: { ephemeral: false, id: "store-1" }, userAgent: "UA" });
    expect(f.calls[0]).toEqual(["create", window.getNativeWindowHandle(), "store-1", "UA"]);
  });

  test("an ephemeral store reaches the add-on as no identifier (the non-persistent store)", () => {
    const f = fakeAddon();
    createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ store: { ephemeral: true }, userAgent: "UA" });
    expect(f.calls[0]).toEqual(["create", window.getNativeWindowHandle(), "", "UA"]);
  });

  test("a store is removed by its identifier, and a refusal rejects", async () => {
    const f = fakeAddon();
    const bridge = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!;
    await expect(bridge.removeStore("store-1")).resolves.toBeUndefined();
    await expect(bridge.removeStore("busy")).rejects.toThrow("in use");
    expect(f.calls).toEqual([
      ["removeStore", "store-1"],
      ["removeStore", "busy"],
    ]);
  });

  test("calls reach the view by its id", () => {
    const f = fakeAddon();
    const view = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ store: { ephemeral: true }, userAgent: "u" });
    view.load("https://x.test/");
    view.addUserScript("js", "couch");
    view.addUserScript("page js", "page");
    view.addMessageHandler("couch");
    view.setFrame(0, 0, 10, 20);
    view.setVisible(true);
    view.focus();
    view.sendKey("Return", true);
    view.destroy();
    expect(f.calls.slice(1)).toEqual([
      ["load", 7, "https://x.test/"],
      ["script", 7, "js", "couch"],
      ["script", 7, "page js", "page"],
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
    )!.create({ store: { ephemeral: true }, userAgent: "u" });
    await expect(view.evaluate("two", { kind: "expression" })).resolves.toBe(2);
    await expect(view.evaluate("x", { kind: "body" })).resolves.toEqual({ a: 1 });
    await expect(view.evaluate("boom", { kind: "expression" })).rejects.toThrow("SyntaxError");
  });

  test("the mode is passed to the add-on as given, and a throw runs the script once", async () => {
    const f = fakeAddon();
    const view = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ store: { ephemeral: true }, userAgent: "u" });
    await expect(view.evaluate("boom", { kind: "expression" })).rejects.toThrow();
    await view.evaluate("var a = 1; return a", { kind: "body" });
    expect(f.calls.filter((c) => c[0] === "evaluate")).toEqual([
      ["evaluate", 7, "boom", "expression"],
      ["evaluate", 7, "var a = 1; return a", "body"],
    ]);
  });

  test("native events become WebKit events, with the frame WebKit reports", () => {
    const f = fakeAddon();
    const view = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ store: { ephemeral: true }, userAgent: "u" });
    const seen: WebKitEvent[] = [];
    const stop = view.onEvent((e) => seen.push(e));
    const frame = { isMainFrame: true, origin: "https://www.netflix.com" };
    f.fire("message", "couch", JSON.stringify({ body: { type: "route" }, frame }));
    f.fire("message", "couch", JSON.stringify({ body: { type: "x" } }));
    f.fire("loaded", "https://a/");
    f.fire("navigated", "https://b/");
    f.fire("failed", "offline");
    stop();
    f.fire("loaded", "https://c/");
    expect(seen).toEqual([
      { type: "message", name: "couch", body: { type: "route" }, frame },
      {
        type: "message",
        name: "couch",
        body: { type: "x" },
        frame: { isMainFrame: false, origin: "" },
      },
      { type: "loaded", url: "https://a/" },
      { type: "navigated", url: "https://b/" },
      { type: "failed", error: "offline" },
    ]);
  });

  test("cookies reach the view's store as JSON, and a refusal rejects", async () => {
    const f = fakeAddon();
    const view = createWebKitBridge(
      () => window as any,
      () => f.addon,
    )!.create({ store: { ephemeral: false, id: "s" }, userAgent: "UA" });
    const cookie = {
      domain: ".netflix.com",
      name: "n",
      path: "/",
      value: "v",
      secure: true,
      httpOnly: false,
      expires: 5000,
    };
    await view.setCookies([cookie]);
    expect(f.calls.at(-1)).toEqual(["cookies", 7, JSON.stringify([cookie])]);
    await expect(view.setCookies([{ ...cookie, name: "refuse" }])).rejects.toThrow("refused");
  });
});
