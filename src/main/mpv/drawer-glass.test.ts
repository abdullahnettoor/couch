import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createDrawerGlass } from "./embed-addon.ts";

const handle = Buffer.from("window");
const win = { isDestroyed: () => false, getNativeWindowHandle: () => handle } as BrowserWindow;
const rect = { x: 1286.4, y: 0, w: 633.6, h: 1080, r: 36 };

function fake(supported: boolean) {
  const calls: unknown[][] = [];
  return {
    calls,
    addon: {
      glassSupported: () => supported,
      setDrawerGlass: (...args: unknown[]) => calls.push(args),
    },
  };
}

afterEach(() => {
  delete process.env.COUCH_NATIVE_GLASS;
});

describe("the drawer glass through the native add-on", () => {
  test("open and close reach the add-on with the window handle, rect and duration", () => {
    const { addon, calls } = fake(true);
    const glass = createDrawerGlass(
      () => win,
      () => addon,
    )!;
    glass.open(rect, 250);
    glass.close(250);
    glass.close(0);
    expect(calls).toEqual([
      [handle, true, 1286.4, 0, 633.6, 1080, 36, 250],
      [handle, false, 0, 0, 0, 0, 0, 250],
      [handle, false, 0, 0, 0, 0, 0, 0],
    ]);
  });

  test("is unavailable when glass isn't supported, is switched off, or the add-on is missing", () => {
    expect(
      createDrawerGlass(
        () => win,
        () => fake(false).addon,
      ),
    ).toBeUndefined();
    process.env.COUCH_NATIVE_GLASS = "0";
    expect(
      createDrawerGlass(
        () => win,
        () => fake(true).addon,
      ),
    ).toBeUndefined();
    delete process.env.COUCH_NATIVE_GLASS;
    expect(
      createDrawerGlass(
        () => win,
        () => {
          throw new Error("no add-on");
        },
      ),
    ).toBeUndefined();
  });

  test("does nothing once the window is gone", () => {
    const { addon, calls } = fake(true);
    const glass = createDrawerGlass(
      () => undefined,
      () => addon,
    )!;
    glass.close(0);
    expect(calls).toEqual([]);
  });
});
