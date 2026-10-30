import { describe, expect, test } from "vite-plus/test";
import { runPage } from "./page-runner.ts";

interface Opts {
  standalone?: boolean;
  noApi?: boolean;
  userAgent?: string;
  lockFails?: boolean;
  requestFails?: boolean;
}

function load(opts: Opts = {}) {
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  const on = (n: string, f: (e?: unknown) => void) => (handlers[n] ??= []).push(f);
  const fire = (n: string, e?: unknown) => handlers[n]?.forEach((f) => f(e));
  const requests: unknown[] = [];
  const locks: string[] = [];
  const doc: Record<string, unknown> = {
    fullscreenElement: null,
    visibilityState: "visible",
    getElementById: () =>
      new Proxy(
        {},
        {
          get: (_t, k) =>
            k === "disabled"
              ? false
              : k === "classList"
                ? { toggle() {}, add() {}, remove() {} }
                : k === "style"
                  ? {}
                  : () => {},
          set: () => true,
        },
      ),
    querySelectorAll: () => [],
    addEventListener: on,
    body: { classList: { toggle() {} } },
  };
  if (!opts.noApi) {
    doc.documentElement = {
      requestFullscreen: (o: unknown) => {
        requests.push(o);
        if (opts.requestFails) return Promise.reject(new Error("no"));
        doc.fullscreenElement = doc.documentElement;
        fire("fullscreenchange");
        return Promise.resolve();
      },
    };
  } else doc.documentElement = {};
  const { sent, sockets } = runPage({
    document: doc,
    window: {
      matchMedia: (q: string) => ({ matches: !!opts.standalone && q.includes("standalone") }),
    },
    screen: {
      orientation: {
        lock: (o: string) => {
          locks.push(o);
          return opts.lockFails ? Promise.reject(new Error("no")) : Promise.resolve();
        },
      },
    },
    navigator: { userAgent: opts.userAgent ?? "Mozilla/5.0 (Linux; Android 14) Chrome/120" },
  });
  sockets[0]!.onopen?.();
  sockets[0]!.onmessage?.({
    data: JSON.stringify({
      type: "snapshot",
      where: "Home",
      layout: "home",
      typing: "none",
      volume: 30,
      muted: false,
      remotes: 1,
    }),
  });
  const tap = () =>
    fire("click", {
      target: {
        closest: () => ({
          disabled: false,
          getAttribute: (n: string) => (n === "data-cmd" ? "select" : null),
        }),
      },
    });
  const leave = (hidden: boolean) => {
    if (hidden) doc.visibilityState = "hidden";
    doc.fullscreenElement = null;
    fire("fullscreenchange");
    if (hidden) fire("visibilitychange");
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { tap, leave, flush, requests, locks, sent, doc, fire };
}

describe("Remote full screen on first tap", () => {
  test("the first tap requests full screen once and still sends its command", async () => {
    const p = load();
    p.tap();
    p.tap();
    await p.flush();
    expect(p.requests).toEqual([{ navigationUI: "hide" }]);
    expect(p.sent.filter((m) => m.includes('"select"'))).toHaveLength(2);
  });

  test("tries to lock portrait and ignores a refusal", async () => {
    const p = load({ lockFails: true });
    p.tap();
    await p.flush();
    expect(p.locks).toEqual(["portrait"]);
    expect(p.sent.length).toBeGreaterThan(0);
  });

  test("a refused request does not break the tap", async () => {
    const p = load({ requestFails: true });
    p.tap();
    await p.flush();
    expect(p.sent.filter((m) => m.includes('"select"'))).toHaveLength(1);
  });

  test("never asks when standalone, unsupported or on iOS", async () => {
    for (const o of [
      { standalone: true },
      { noApi: true },
      { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari" },
    ]) {
      const p = load(o);
      p.tap();
      await p.flush();
      expect(p.requests).toHaveLength(0);
      expect(p.sent.filter((m) => m.includes('"select"'))).toHaveLength(1);
    }
  });

  test("after a deliberate exit while visible it does not ask again", async () => {
    const p = load();
    p.tap();
    await p.flush();
    p.leave(false);
    p.tap();
    await p.flush();
    expect(p.requests).toHaveLength(1);
  });

  test("a deliberate exit survives switching apps and coming back", async () => {
    const p = load();
    p.tap();
    await p.flush();
    p.leave(false);
    p.doc.visibilityState = "hidden";
    p.fire("visibilitychange");
    p.doc.visibilityState = "visible";
    p.fire("visibilitychange");
    p.tap();
    await p.flush();
    expect(p.requests).toHaveLength(1);
  });

  test("after leaving (hidden) the next tap asks again", async () => {
    const p = load();
    p.tap();
    await p.flush();
    p.leave(true);
    p.doc.visibilityState = "visible";
    p.tap();
    await p.flush();
    expect(p.requests).toHaveLength(2);
  });

  test("hidden reported before the exit still counts as leaving", async () => {
    const p = load();
    p.tap();
    await p.flush();
    p.doc.visibilityState = "hidden";
    p.fire("visibilitychange");
    p.doc.fullscreenElement = null;
    p.fire("fullscreenchange");
    p.doc.visibilityState = "visible";
    p.tap();
    await p.flush();
    expect(p.requests).toHaveLength(2);
  });
});
