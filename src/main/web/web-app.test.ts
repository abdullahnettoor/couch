import { expect, test } from "vite-plus/test";
import { drmGate, seekPlan, urlRoute, type WebAppDescription } from "./web-app.ts";

type Skip = NonNullable<WebAppDescription["skip"]>;
const skip: Skip = { keys: () => ["right", "right"], controlsHideMs: 1, commitMs: 2 };

test("a description's skip drives the scrubber and commits with OK", () => {
  expect(seekPlan({ skip }, 10, true)).toEqual({ keys: ["right", "right"], commit: true });
});

test("without skip, seek keys are sent once per skip, nothing to commit", () => {
  const seekKeys = { back: "left", forward: "right" } as const;
  expect(seekPlan({ seekKeys }, -10, false)).toEqual({ keys: ["left"], commit: false });
  expect(seekPlan({ seekKeys }, 10, false)).toEqual({ keys: ["right"], commit: false });
});

test("with neither, a skip does nothing", () => {
  expect(seekPlan({}, 10, false)).toEqual({ keys: [], commit: false });
});

test("a URL-only route says home from the address alone", () => {
  const route = urlRoute((url) => url.pathname === "/browse");
  const tracker = route.tracker();
  expect(tracker.update("https://www.netflix.com/browse", route.idle)).toEqual({ home: true });
  expect(tracker.update("https://www.netflix.com/title/1", route.idle)).toEqual({ home: false });
});

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
