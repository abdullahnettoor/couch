import { describe, expect, test, vi } from "vite-plus/test";
import { MemoryStore } from "../ports/store.ts";
import { checkFairPlay, FAIRPLAY_SCRIPT, startFairPlay } from "./fairplay.ts";

const granted = { keySystems: { "com.apple.fps.3_0": "granted" } };
const denied = { keySystems: { "com.apple.fps.3_0": "denied: NotSupportedError" } };

function rig(run: (() => Promise<unknown>) | undefined, version = "27.2|26.0") {
  const store = new MemoryStore();
  let runs = 0;
  const check = () =>
    checkFairPlay({
      store,
      version,
      run: run && (() => (runs++, run())),
      timeoutMs: 20,
    });
  return { store, check, runs: () => runs };
}

describe("asking the add-on whether FairPlay is available", () => {
  test("the probe asks for FairPlay and only that", () => {
    expect(FAIRPLAY_SCRIPT).toContain("com.apple.fps.3_0");
    expect(FAIRPLAY_SCRIPT).not.toContain("enumerateDevices");
  });

  test("granted means available", async () => {
    expect(await rig(async () => granted).check()).toEqual({ available: true });
  });

  test("denied means unavailable, with a reason for the row", async () => {
    const r = await rig(async () => denied).check();
    expect(r.available).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/FairPlay/);
  });

  test("no add-on means unavailable, with a reason", async () => {
    const r = await rig(undefined).check();
    expect(r).toEqual({ available: false, reason: expect.stringMatching(/add-on/i) });
  });

  test("an answer is cached, so the next start doesn't ask again", async () => {
    const t = rig(async () => granted);
    await t.check();
    await t.check();
    expect(t.runs()).toBe(1);
  });

  test("a denial is cached too", async () => {
    const t = rig(async () => denied);
    await t.check();
    expect((await t.check()).available).toBe(false);
    expect(t.runs()).toBe(1);
  });

  test("a new Safari or macOS version asks again", async () => {
    const t = rig(async () => granted);
    await t.check();
    const again = await checkFairPlay({
      store: t.store,
      version: "28.0|27.0",
      run: async () => denied,
      timeoutMs: 20,
    });
    expect(again.available).toBe(false);
  });

  test("a failed or hung probe is unavailable and is not cached", async () => {
    const t = rig(() => Promise.reject(new Error("boom")));
    expect((await t.check()).available).toBe(false);
    expect((await t.check()).available).toBe(false);
    expect(t.runs()).toBe(2);
    const hung = rig(() => new Promise(() => {}));
    const r = await hung.check();
    expect(r).toEqual({ available: false, reason: expect.stringMatching(/check/i) });
    await hung.check();
    expect(hung.runs()).toBe(2);
  });
});

describe("unexpected probe results", () => {
  const odd: unknown[] = [
    null,
    undefined,
    "granted",
    42,
    {},
    { keySystems: null },
    { keySystems: {} },
    { keySystems: { "com.apple.fps.3_0": null } },
    { keySystems: { "com.apple.fps.3_0": "maybe" } },
    { keySystems: { "com.apple.fps.3_0": "granted-ish" } },
  ];

  test.each(odd.map((r, i) => [i, r] as const))(
    "result %i is a failed check: not cached, asked again next start",
    async (_i, result) => {
      const t = rig(async () => result);
      const first = await t.check();
      expect(first).toEqual({ available: false, reason: expect.stringMatching(/check/i) });
      expect(t.store.read("webkit-fairplay", {})).toEqual({});
      await t.check();
      expect(t.runs()).toBe(2);
    },
  );

  test("a later clear answer is cached after a malformed one", async () => {
    let answer: unknown = {};
    const t = rig(async () => answer);
    await t.check();
    answer = granted;
    expect(await t.check()).toEqual({ available: true });
    await t.check();
    expect(t.runs()).toBe(2);
  });

  test("a clear denial is still cached", async () => {
    const t = rig(async () => denied);
    await t.check();
    expect(t.store.read("webkit-fairplay", {})).toEqual({ version: "27.2|26.0", granted: false });
  });
});

describe("starting without waiting for the probe", () => {
  const base = () => ({ store: new MemoryStore(), version: "27.2|26.0", timeoutMs: 20 });

  test("a cached answer is used at once and the probe isn't run", () => {
    const o = base();
    o.store.write("webkit-fairplay", { version: o.version, granted: true });
    let runs = 0;
    const answers: unknown[] = [];
    const fp = startFairPlay({ ...o, run: () => (runs++, Promise.resolve(granted)) }, (a) =>
      answers.push(a),
    );
    expect(fp.current()).toEqual({ available: true });
    expect(runs).toBe(0);
    expect(answers).toEqual([]);
  });

  test("with no cache it answers 'checking' at once, and a probe that never resolves never blocks", () => {
    const fp = startFairPlay({ ...base(), run: () => new Promise(() => {}) }, () => {});
    expect(fp.current()).toEqual({ available: false, reason: expect.stringMatching(/checking/i) });
  });

  test("a late answer is reported once and becomes the current answer", async () => {
    let release: (v: unknown) => void = () => {};
    const answers: unknown[] = [];
    const fp = startFairPlay(
      { ...base(), timeoutMs: 5000, run: () => new Promise((r) => (release = r)) },
      (a) => answers.push(a),
    );
    release(granted);
    await vi.waitFor(() => expect(answers).toEqual([{ available: true }]));
    expect(fp.current()).toEqual({ available: true });
  });

  test("a failed probe reports 'couldn't check' and is not cached", async () => {
    const o = base();
    const answers: unknown[] = [];
    startFairPlay({ ...o, run: () => Promise.reject(new Error("x")) }, (a) => answers.push(a));
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    expect(answers[0]).toEqual({ available: false, reason: expect.stringMatching(/check/i) });
    expect(o.store.read("webkit-fairplay", {})).toEqual({});
  });

  test("no add-on is final at once", () => {
    const fp = startFairPlay({ ...base(), run: undefined }, () => {});
    expect(fp.current()).toEqual({ available: false, reason: expect.stringMatching(/add-on/i) });
  });
});
