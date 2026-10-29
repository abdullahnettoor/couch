import { describe, expect, test } from "vite-plus/test";
import type { AppPlayback, AppSignIn, SignInResult } from "../apps/app.ts";
import { MemoryStore } from "../ports/store.ts";
import type { Engine } from "./native-front.ts";
import { createWebKitWelcome } from "./webkit-welcome.ts";

function rig(
  o: {
    engine?: Engine;
    cookies?: boolean | "throws";
    copy?: SignInResult;
    selectFails?: boolean;
    store?: MemoryStore;
  } = {},
) {
  const store = o.store ?? new MemoryStore();
  const calls: string[] = [];
  let engine: Engine = o.engine ?? "webkit";
  const signIn: AppSignIn = {
    copyFromCouch: {
      available: async () => {
        calls.push("available");
        if (o.cookies === "throws") throw new Error("no");
        return o.cookies ?? true;
      },
      copy: async () => (calls.push("copy"), o.copy ?? { ok: true, count: 3 }),
    },
    signOut: async () => void calls.push("signOut"),
  };
  const playback = {
    select: async (id: string) => {
      calls.push(`select:${id}`);
      if (o.selectFails) throw new Error("boom");
      engine = id as Engine;
    },
  } as unknown as AppPlayback;
  const make = () =>
    createWebKitWelcome({
      store,
      appId: "netflix",
      label: "Netflix",
      engine: () => engine,
      signIn: () => signIn,
      playback,
    });
  return { store, calls, welcome: make(), make, engine: () => engine };
}

describe("the welcome when Netflix first opens on WebKit", () => {
  test("asks, with Copy sign-in from Couch first when Couch's Chromium holds a sign-in", async () => {
    const { welcome } = rig();
    const q = await welcome.question();
    expect(q?.title).toBe("Netflix now plays in sharper quality");
    expect(q?.body).toBe("It needs its own sign-in.");
    expect(q?.choices).toEqual([
      { id: "copy", label: "Copy sign-in from Couch" },
      { id: "signin", label: "Sign in on Netflix" },
      { id: "chromium", label: "Keep using Chromium" },
    ]);
  });

  test("a new user, with no Chromium cookies or none readable, gets no welcome", async () => {
    for (const cookies of [false, "throws"] as const) {
      const r = rig({ cookies });
      expect(await r.welcome.question()).toBeUndefined();
      expect(r.calls).toEqual(["available"]);
      expect(r.engine()).toBe("webkit");
    }
  });

  test("Back stands for Sign in on Netflix", async () => {
    expect((await rig().welcome.question())?.back).toBe("signin");
  });

  test("an App with no Chromium sign-in source gets no welcome", async () => {
    const r = rig();
    const welcome = createWebKitWelcome({
      store: r.store,
      appId: "netflix",
      label: "Netflix",
      engine: () => "webkit",
      signIn: () => undefined,
      playback: {} as AppPlayback,
    });
    expect(await welcome.question()).toBeUndefined();
  });

  test("never asks on Chromium", async () => {
    const { welcome, calls } = rig({ engine: "chromium" });
    expect(await welcome.question()).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("asking copies nothing", async () => {
    const { welcome, calls } = rig();
    await welcome.question();
    expect(calls).toEqual(["available"]);
  });

  test("Copy sign-in from Couch copies, and says how many", async () => {
    const { welcome, calls } = rig();
    expect(await welcome.answer("copy")).toBe("Copied 3 Netflix cookies");
    expect(calls).toEqual(["copy"]);
  });

  test("a copy that finds nothing or fails says so; a cancelled one is quiet", async () => {
    expect(await rig({ copy: { ok: false, reason: "none" } }).welcome.answer("copy")).toBe(
      "No Netflix sign-in found in Couch",
    );
    expect(await rig({ copy: { ok: false, reason: "failed" } }).welcome.answer("copy")).toBe(
      "Couldn't copy the sign-in from Couch",
    );
    expect(await rig({ copy: { ok: false, reason: "cancelled" } }).welcome.answer("copy")).toBe(
      undefined,
    );
  });

  test("Sign in on Netflix only opens the page", async () => {
    const { welcome, calls } = rig();
    expect(await welcome.answer("signin")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("Keep using Chromium switches Playback to Chromium, which stores the choice", async () => {
    const { welcome, calls, engine } = rig();
    expect(await welcome.answer("chromium")).toBeUndefined();
    expect(calls).toEqual(["select:chromium"]);
    expect(engine()).toBe("chromium");
  });

  test("a switch that fails says so", async () => {
    const { welcome } = rig({ selectFails: true });
    expect(await welcome.answer("chromium")).toBe("Couldn't switch Netflix's playback");
  });

  test.each(["copy", "signin", "chromium"])("%s: it is never asked again", async (id) => {
    const r = rig();
    await r.welcome.answer(id);
    // Even once Netflix is back on WebKit, and after a restart (a new welcome on the same store).
    expect(await r.welcome.question()).toBeUndefined();
    const again = rig({ store: r.store });
    expect(await again.welcome.question()).toBeUndefined();
  });

  test("a copy that failed is still an answer", async () => {
    const r = rig({ copy: { ok: false, reason: "failed" } });
    await r.welcome.answer("copy");
    expect(await r.welcome.question()).toBeUndefined();
  });

  test("a question left unanswered is asked again", async () => {
    const r = rig();
    await r.welcome.question();
    const again = rig({ store: r.store });
    expect((await again.welcome.question())?.choices).toHaveLength(3);
  });

  test("an unknown answer changes nothing and is not an answer", async () => {
    const r = rig();
    expect(await r.welcome.answer("surprise")).toBeUndefined();
    expect(r.calls).toEqual([]);
    expect(await r.welcome.question()).toBeDefined();
  });

  test("the household that moved to WebKit later is asked on its next open, once", async () => {
    // A Chromium household (no answer stored) that the background probe moved to WebKit.
    const store = new MemoryStore();
    const chromium = rig({ store, engine: "chromium" });
    expect(await chromium.welcome.question()).toBeUndefined();
    const webkit = rig({ store, engine: "webkit" });
    expect(await webkit.welcome.question()).toBeDefined();
    await webkit.welcome.answer("signin");
    expect(await webkit.welcome.question()).toBeUndefined();
  });

  test("answers are kept per App, in their own document", async () => {
    const r = rig();
    await r.welcome.answer("signin");
    expect(r.store.read("apps-welcome", {})).toEqual({ netflix: true });
  });
});
