import { describe, expect, test } from "vite-plus/test";
import { deliverPointerInput, type InputTarget } from "./pointer-delivery.ts";

function targets() {
  const sent = { page: [] as unknown[], quick: [] as unknown[] };
  const make = (into: unknown[]): InputTarget => ({ sendInputEvent: (e) => void into.push(e) });
  return { sent, targets: { page: () => make(sent.page), quick: () => make(sent.quick) } };
}

describe("a pointer event reaches the layer as mouse input", () => {
  test("a move is a mouse move at the point", () => {
    const { sent, targets: t } = targets();
    deliverPointerInput({ layer: "page", type: "move", x: 100.4, y: 50.6 }, t);
    expect(sent.page).toEqual([{ type: "mouseMove", x: 100, y: 51 }]);
    expect(sent.quick).toEqual([]);
  });

  test("a click is a left press and release at the point, after a move there", () => {
    const { sent, targets: t } = targets();
    deliverPointerInput({ layer: "quick", type: "click", x: 10, y: 20 }, t);
    expect(sent.quick).toEqual([
      { type: "mouseMove", x: 10, y: 20 },
      { type: "mouseDown", x: 10, y: 20, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 10, y: 20, button: "left", clickCount: 1 },
    ]);
    expect(sent.page).toEqual([]);
  });

  test("a right-click is a right press and release", () => {
    const { sent, targets: t } = targets();
    deliverPointerInput({ layer: "page", type: "rightClick", x: 5, y: 6 }, t);
    expect(sent.page.slice(1)).toEqual([
      { type: "mouseDown", x: 5, y: 6, button: "right", clickCount: 1 },
      { type: "mouseUp", x: 5, y: 6, button: "right", clickCount: 1 },
    ]);
  });

  test("a scroll is a wheel turn", () => {
    const { sent, targets: t } = targets();
    deliverPointerInput({ layer: "page", type: "scroll", x: 5, y: 6, dx: 0, dy: -40 }, t);
    expect(sent.page).toEqual([{ type: "mouseWheel", x: 5, y: 6, deltaX: 0, deltaY: -40 }]);
  });

  test("a layer that isn't there gets nothing, and an App is never given input here", () => {
    const { sent } = targets();
    expect(() =>
      deliverPointerInput(
        { layer: "quick", type: "click", x: 1, y: 1 },
        { page: () => undefined, quick: () => undefined },
      ),
    ).not.toThrow();
    deliverPointerInput({ layer: "app", type: "click", x: 1, y: 1 }, targets().targets);
    expect(sent.page).toEqual([]);
  });
});
