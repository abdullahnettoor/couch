import { describe, expect, test } from "vite-plus/test";
import type { ScreenPayload } from "../shared/protocol.ts";
import { wheelScrolls, wheelSteps } from "./wheel-steps.ts";

const px = (deltaY: number, deltaX = 0) => ({ deltaX, deltaY, deltaMode: 0 });

describe("the wheel as arrow presses", () => {
  test("one mouse notch is one row, down or up", () => {
    const step = wheelSteps();
    expect(step(px(100), 0)).toEqual({ command: "down" });
    expect(step(px(-100), 1000)).toEqual({ command: "up" });
  });

  test("a line-mode notch is one row", () => {
    expect(wheelSteps()({ deltaX: 0, deltaY: 1, deltaMode: 1 }, 0)).toEqual({ command: "down" });
  });

  test("small trackpad deltas step once per distance", () => {
    const step = wheelSteps();
    const sent = Array.from({ length: 15 }, (_, i) => step(px(10), i * 30)).filter(Boolean);
    expect(sent).toEqual([{ command: "down" }, { command: "down" }]);
  });

  test("a momentum tail inside the cooldown does not step", () => {
    const step = wheelSteps();
    expect(step(px(100), 0)).toEqual({ command: "down" });
    expect(step(px(100), 40)).toBeUndefined();
  });

  test("a horizontal swipe steps left and right", () => {
    const step = wheelSteps();
    expect(step(px(0, 80), 0)).toEqual({ command: "right" });
    expect(step(px(0, -80), 500)).toEqual({ command: "left" });
  });

  test("drift on the other axis does not step", () => {
    const step = wheelSteps();
    expect(step(px(20, 70), 0)).toEqual({ command: "right" });
    expect(step(px(5, 20), 500)).toBeUndefined();
  });

  test("reversing direction forgets the distance so far", () => {
    const step = wheelSteps();
    expect(step(px(40), 0)).toBeUndefined();
    expect(step(px(-40), 20)).toBeUndefined();
    expect(step(px(-40), 40)).toEqual({ command: "up" });
  });
});

const screen = (view: string, extra: object = {}, state: object = {}) =>
  ({ state: { view, pictureOff: false, ...state }, ...extra }) as unknown as ScreenPayload;

describe("where the wheel scrolls", () => {
  test.each(["library", "folder", "show", "librarySearch"])("%s takes the wheel", (view) => {
    expect(wheelScrolls(screen(view))).toBe(true);
  });

  test.each(["player", "home", "settings", "app"])("%s does not", (view) => {
    expect(wheelScrolls(screen(view))).toBe(false);
  });

  test("not under Quick settings, a confirm question or the picture-off cover", () => {
    expect(wheelScrolls(screen("library", { quick: {} }))).toBe(false);
    expect(wheelScrolls(screen("library", {}, { confirm: { title: "Quit?" } }))).toBe(false);
    expect(wheelScrolls(screen("library", {}, { pictureOff: true }))).toBe(false);
  });
});
