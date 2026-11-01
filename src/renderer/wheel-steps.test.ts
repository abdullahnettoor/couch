import { describe, expect, test } from "vite-plus/test";
import type { ScreenPayload } from "../shared/protocol.ts";
import { wheelScrolls, wheelSteps } from "./wheel-steps.ts";

const D = { command: "down" };
const U = { command: "up" };
const px = (deltaY: number, deltaX = 0) => ({ deltaX, deltaY, deltaMode: 0 });
const run = (events: [number, ReturnType<typeof px>][]) => {
  const step = wheelSteps();
  return events.flatMap(([t, e]) => step(e, t));
};

describe("the wheel as arrow presses", () => {
  test("one mouse notch is one row, down or up", () => {
    const step = wheelSteps();
    expect(step(px(100), 0)).toEqual([D]);
    expect(step(px(-100), 1000)).toEqual([U]);
  });

  test("four rapid notches are four steps, none lost to a cooldown", () => {
    expect(run([0, 50, 100, 150].map((t) => [t, px(100)]))).toEqual([D, D, D, D]);
  });

  test("an accelerated event of three notches is three steps; a huge one is capped", () => {
    expect(run([[0, px(300)]])).toEqual([D, D, D]);
    expect(run([[0, px(5000)]])).toEqual([D, D, D]);
  });

  test("a line-mode notch is one row, a page is one step", () => {
    const step = wheelSteps();
    expect(step({ deltaX: 0, deltaY: 1, deltaMode: 1 }, 0)).toEqual([D]);
    expect(step({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 500)).toEqual([D]);
  });

  test("small trackpad deltas step once per distance", () => {
    const sent = run(Array.from({ length: 15 }, (_, i) => [i * 30, px(10)]));
    expect(sent).toEqual([D, D]);
  });

  test("just below the step distance does not step, exactly at it does", () => {
    expect(
      run([
        [0, px(30)],
        [10, px(29)],
      ]),
    ).toEqual([]);
    expect(
      run([
        [0, px(30)],
        [10, px(30)],
      ]),
    ).toEqual([D]);
  });

  test("a pause clears a partial distance", () => {
    expect(
      run([
        [0, px(40)],
        [400, px(40)],
      ]),
    ).toEqual([]);
  });

  test("trackpad cooldown: blocked inside 90ms, free at the boundary", () => {
    const burst = (t: number) =>
      run([
        [0, px(30)],
        [5, px(30)],
        [t, px(30)],
        [t + 5, px(30)],
      ]);
    expect(burst(50)).toEqual([D]);
    expect(burst(95)).toEqual([D, D]);
  });

  test("a long decaying momentum tail gives no extra steps", () => {
    const events: [number, ReturnType<typeof px>][] = [
      [0, px(30)],
      [16, px(40)],
    ];
    for (let i = 0; i < 120; i++) events.push([32 + i * 16, px(8 * 0.985 ** i)]);
    expect(run(events)).toEqual([D]);
  });

  test("a fresh deliberate swipe after the tail still steps", () => {
    const events: [number, ReturnType<typeof px>][] = [
      [0, px(30)],
      [16, px(40)],
    ];
    for (let i = 0; i < 20; i++) events.push([32 + i * 16, px(8)]);
    events.push([400, px(40)], [416, px(40)]);
    expect(run(events)).toEqual([D, D]);
  });

  test("a reversal steps", () => {
    expect(
      run([
        [0, px(30)],
        [16, px(40)],
        [200, px(-40)],
        [216, px(-40)],
      ]),
    ).toEqual([D, U]);
  });

  test("a horizontal swipe steps left and right", () => {
    const step = wheelSteps();
    expect(step(px(0, 80), 0)).toEqual([{ command: "right" }]);
    expect(step(px(0, -80), 500)).toEqual([{ command: "left" }]);
  });

  test("drift on the other axis does not step", () => {
    const step = wheelSteps();
    expect(step(px(20, 70), 0)).toEqual([{ command: "right" }]);
    expect(step(px(5, 20), 500)).toEqual([]);
  });

  test("reversing direction forgets the distance so far", () => {
    expect(
      run([
        [0, px(40)],
        [20, px(-40)],
        [40, px(-40)],
      ]),
    ).toEqual([U]);
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
