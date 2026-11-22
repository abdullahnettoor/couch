import { describe, expect, test } from "vite-plus/test";
import { TEXT_SIZE_MULTIPLIER, textZoom } from "./text-size.ts";

describe("textZoom", () => {
  test("multipliers are 0.85 / 1 / 1.2", () => {
    expect(TEXT_SIZE_MULTIPLIER).toEqual({ smaller: 0.85, default: 1, larger: 1.2 });
  });

  test.each([
    [1280, 1],
    [1512, 1.1812],
    [1920, 1.5],
    [2560, 2],
    [3840, 3],
  ])("a %i pt window with target 1280 at Default zooms %f", (width, zoom) => {
    expect(textZoom(width, 1280, "default")).toBeCloseTo(zoom, 3);
  });

  test("the size multiplies the width ratio", () => {
    expect(textZoom(1920, 1280, "smaller")).toBeCloseTo(1.275, 5);
    expect(textZoom(1920, 1280, "larger")).toBeCloseTo(1.8, 5);
  });

  test("a window narrower than the target is never zoomed in by the width ratio (floor of 1 before the size)", () => {
    expect(textZoom(1000, 1280, "default")).toBe(1);
    expect(textZoom(1000, 1280, "smaller")).toBeCloseTo(0.85, 5);
    expect(textZoom(1000, 1280, "larger")).toBeCloseTo(1.2, 5);
  });

  test("clamps to Chromium's range", () => {
    expect(textZoom(10000, 1280, "larger")).toBe(5);
    expect(textZoom(1920, 1, "default")).toBe(5);
  });
});
