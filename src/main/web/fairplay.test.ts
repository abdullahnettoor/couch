import { describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "../ports/store.ts";
import { checkFairPlay, FAIRPLAY_SCRIPT } from "./fairplay.ts";

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
