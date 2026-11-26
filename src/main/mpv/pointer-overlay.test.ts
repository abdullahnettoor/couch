import type { BrowserWindow } from "electron";
import { describe, expect, test } from "vite-plus/test";
import { GLASS } from "../../shared/look.ts";
import { pointerPixels } from "../../shared/pointer.ts";
import { createPointerOverlay } from "./embed-addon.ts";

const handle = Buffer.from("window");
const win = { isDestroyed: () => false, getNativeWindowHandle: () => handle } as BrowserWindow;

describe("the pointer overlay through the native add-on", () => {
  test("placing and styling reach the add-on with the window handle", () => {
    const calls: unknown[][] = [];
    const overlay = createPointerOverlay(
      () => win,
      () => ({
        setPointer: (...args: unknown[]) => void calls.push(["place", ...args]),
        setPointerStyle: (...args: unknown[]) => void calls.push(["style", ...args]),
      }),
    )!;
    const style = pointerPixels(GLASS, 1920);
    overlay.setStyle(style);
    overlay.place(10, 20, true);
    expect(calls).toEqual([
      ["style", handle, JSON.stringify(style)],
      ["place", handle, 10, 20, true],
    ]);
  });

  test("an add-on without it (an older build), or none, leaves the renderer to draw", () => {
    expect(
      createPointerOverlay(
        () => win,
        () => ({}),
      ),
    ).toBeUndefined();
    expect(
      createPointerOverlay(
        () => win,
        () => {
          throw new Error("no add-on");
        },
      ),
    ).toBeUndefined();
  });

  test("a window that is gone is left alone", () => {
    const calls: unknown[] = [];
    const overlay = createPointerOverlay(
      () => ({ isDestroyed: () => true }) as BrowserWindow,
      () => ({ setPointer: () => void calls.push(1), setPointerStyle: () => void calls.push(2) }),
    )!;
    overlay.place(1, 2, true);
    overlay.setStyle(pointerPixels(GLASS, 1920));
    expect(calls).toEqual([]);
  });
});
