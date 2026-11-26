import { describe, expect, test } from "vite-plus/test";
import type { PointerDraw, PointerPixels } from "../shared/pointer.ts";
import { PointerPresenter, type NativePointer } from "./pointer-presenter.ts";

const draw = (x: number, y: number, shown = true): PointerDraw => ({ x, y, shown, style: "arrow" });

function rig(native: boolean, width = () => 1920) {
  const fallback: PointerDraw[] = [];
  const calls: Array<["style", PointerPixels] | ["place", number, number, boolean]> = [];
  const overlay: NativePointer = {
    setStyle: (s) => calls.push(["style", s]),
    place: (x, y, shown) => calls.push(["place", x, y, shown]),
  };
  const presenter = new PointerPresenter({
    native: native ? overlay : undefined,
    fallback: (d) => fallback.push(d),
    width,
  });
  return { presenter, fallback, calls };
}

describe("drawing the pointer", () => {
  test("with the native overlay, it is placed there and the renderer draws nothing", () => {
    const { presenter, fallback, calls } = rig(true);
    presenter.draw(draw(10, 20));
    presenter.draw(draw(30, 40, false));
    expect(fallback).toEqual([]);
    expect(calls.filter((c) => c[0] === "place")).toEqual([
      ["place", 10, 20, true],
      ["place", 30, 40, false],
    ]);
    expect(presenter.native).toBe(true);
  });

  test("the overlay gets its look once, and again when the window's size changes", () => {
    let width = 1920;
    const { presenter, calls } = rig(true, () => width);
    presenter.draw(draw(1, 1));
    presenter.draw(draw(2, 2));
    width = 960;
    presenter.draw(draw(3, 3));
    const styles = calls.filter((c): c is ["style", PointerPixels] => c[0] === "style");
    expect(styles).toHaveLength(2);
    expect(styles[1]![1].height).toBeCloseTo(styles[0]![1].height / 2);
  });

  test("without the add-on, the renderer draws it", () => {
    const { presenter, fallback } = rig(false);
    presenter.draw(draw(5, 6));
    expect(fallback).toEqual([draw(5, 6)]);
    expect(presenter.native).toBe(false);
  });
});
