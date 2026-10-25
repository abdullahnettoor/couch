import { describe, expect, test } from "vite-plus/test";
import { screenPointer } from "./pointer-position.ts";

describe("screenPointer", () => {
  test("is relative to the window's content bounds, with its width", () => {
    const b = { x: 100, y: 50, width: 1280, height: 720 };
    expect(screenPointer({ x: 150, y: 80 }, b)).toEqual({ x: 50, y: 30, width: 1280 });
  });

  test("handles a secondary display with a positive origin", () => {
    const b = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(screenPointer({ x: 3839, y: 500 }, b)).toEqual({ x: 1919, y: 500, width: 1920 });
  });

  test("handles a secondary display with a negative origin", () => {
    const b = { x: -1920, y: -200, width: 1920, height: 1080 };
    expect(screenPointer({ x: -1, y: 100 }, b)).toEqual({ x: 1919, y: 300, width: 1920 });
    expect(screenPointer({ x: -1921, y: 100 }, b)).toBeUndefined();
  });

  test("reflects the bounds after a move or resize", () => {
    const point = { x: 900, y: 300 };
    expect(screenPointer(point, { x: 0, y: 0, width: 1000, height: 600 })).toEqual({
      x: 900,
      y: 300,
      width: 1000,
    });
    expect(screenPointer(point, { x: 200, y: 100, width: 800, height: 600 })).toEqual({
      x: 700,
      y: 200,
      width: 800,
    });
  });

  test("works with full-screen geometry", () => {
    const b = { x: 0, y: 0, width: 2560, height: 1440 };
    expect(screenPointer({ x: 2559, y: 1439 }, b)).toEqual({ x: 2559, y: 1439, width: 2560 });
  });

  test("is undefined outside the window", () => {
    const b = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(screenPointer({ x: 1920, y: 10 }, b)).toBeUndefined();
    expect(screenPointer({ x: 10, y: 1080 }, b)).toBeUndefined();
    expect(screenPointer({ x: -1, y: 10 }, b)).toBeUndefined();
    expect(screenPointer({ x: 10, y: -1 }, b)).toBeUndefined();
  });
});
