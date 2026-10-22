import { expect, test } from "vite-plus/test";
import { drmGate } from "./drm-gate.ts";

test("a description without drm is ready without asking", async () => {
  const components = { whenReady: () => Promise.reject(new Error("no")) };
  expect(await drmGate({}, components)).toEqual({ ok: true });
});

test("a drm description waits for the components", async () => {
  let ready = false;
  const components = {
    whenReady: async () => {
      ready = true;
      return [];
    },
  };
  expect(await drmGate({ drm: true }, components)).toEqual({ ok: true });
  expect(ready).toBe(true);
});

test("a drm description fails with a note when Widevine can't be installed", async () => {
  const components = { whenReady: () => Promise.reject(new Error("offline")) };
  const gate = await drmGate({ drm: true }, components);
  expect(gate.ok).toBe(false);
  expect(gate).toMatchObject({ note: expect.stringContaining("Widevine") });
});

test("a drm description fails with a note when there is no components API", async () => {
  const gate = await drmGate({ drm: true }, undefined);
  expect(gate).toMatchObject({ ok: false, note: expect.stringContaining("Widevine") });
});
