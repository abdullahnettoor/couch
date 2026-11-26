import { describe, expect, test } from "vite-plus/test";
import { GLASS } from "./look.ts";
import { parseRgba, pointerPixels, pointerSvg } from "./pointer.ts";

describe("the pointer's Look", () => {
  test("it is one arrow style, drawn about twice a Mac cursor tall at TV distance", () => {
    expect(GLASS.pointer.style).toBe("arrow");
    const px = pointerPixels(GLASS, 1920);
    expect(px.height).toBeGreaterThanOrEqual(40);
    expect(px.height).toBeLessThanOrEqual(64);
  });

  test("it scales with the window, so it looks the same on any Screen size", () => {
    const full = pointerPixels(GLASS, 1920);
    const half = pointerPixels(GLASS, 960);
    expect(half.height).toBeCloseTo(full.height / 2);
    expect(half.strokeWidth).toBeCloseTo(full.strokeWidth / 2);
    expect(half.points.at(-1)![0]).toBeCloseTo(full.points.at(-1)![0] / 2);
  });

  test("the tip is where the pointer is", () => {
    expect(pointerPixels(GLASS, 1920).points[0]).toEqual([0, 0]);
  });

  test("colours are read from CSS rgb() and rgba()", () => {
    expect(parseRgba("rgba(255, 0, 51, 0.5)")).toEqual([1, 0, 0.2, 0.5]);
    expect(parseRgba("rgb(0, 255, 0)")).toEqual([0, 1, 0, 1]);
    expect(parseRgba("tomato")).toEqual([0, 0, 0, 1]);
  });

  test("the renderer's fallback draws the same arrow, in the Screen's unit, tip at its corner", () => {
    const svg = pointerSvg(GLASS);
    expect(svg).toContain("<polygon");
    expect(svg).toContain("var(--u)");
    const tip = GLASS.pointer.styles.arrow.points[0]!;
    expect(svg).toContain(`points="${tip[0]},${tip[1]} `);
    expect(svg).toContain(GLASS.pointer.styles.arrow.fill);
  });
});
