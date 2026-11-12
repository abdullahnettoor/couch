import { describe, expect, test } from "vite-plus/test";
import { displacementPixels, rimPixels } from "./clock-glass-maps.ts";

/**
 * A 40 × 40 picture with one solid "digit", a rectangle from (10, 5) to (30, 35). Its height maps are ramps that
 * climb `ramp` pixels inwards from each edge, as a blur of the digit would.
 */
const W = 40;
const H = 40;
const inside = (x: number, y: number) => x >= 10 && x < 30 && y >= 5 && y < 35;
function heights(ramp: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const depth = Math.min(x - 9.5, 29.5 - x, y - 4.5, 34.5 - y);
      data[(y * W + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 + depth / ramp)));
    }
  return data;
}
const shape = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) if (inside(x, y)) shape[(y * W + x) * 4 + 3] = 255;

const digit = { width: W, height: H, shape, lens: heights(8), thin: heights(2) };
const lighting = {
  lensBlur: 4,
  rimBlur: 1,
  step: 1,
  rimStrength: 0.95,
  rimShine: 40,
  // The test digit's thin ramp is steeper than a blur's; a lower relief tilts it about as far as the halfway vector.
  rimRelief: 0.5,
  rimFill: 0,
  bevelStrength: 0,
  light: { x: -0.42, y: -0.91, elevation: 25 },
};
const displacement = displacementPixels(digit, lighting);
const rim = rimPixels(digit, lighting);
const px = (data: Uint8ClampedArray, x: number, y: number) =>
  Array.from(data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

describe("the liquid clock's maps", () => {
  test("outside the digits the picture is left alone and no rim is drawn", () => {
    for (const [x, y] of [
      [2, 2],
      [9, 20],
      [35, 38],
    ] as const) {
      expect(px(displacement, x, y)).toEqual([128, 128, 128, 255]);
      expect(px(rim, x, y)[3]).toBe(0);
    }
  });

  test("near an edge the picture is drawn from further inside the digit, so its edge is magnified", () => {
    const [leftX] = px(displacement, 10, 20);
    const [rightX] = px(displacement, 29, 20);
    const [, topY] = px(displacement, 20, 5);
    const [, bottomY] = px(displacement, 20, 34);
    expect(leftX).toBeGreaterThan(160);
    expect(rightX).toBeLessThan(96);
    expect(topY).toBeGreaterThan(160);
    expect(bottomY).toBeLessThan(96);
    expect(px(displacement, 10, 20)[1]).toBe(128);
  });

  test("in the middle of a stroke the picture is nearly clear", () => {
    const [x, y] = px(displacement, 20, 20);
    expect(Math.abs(x! - 128)).toBeLessThan(8);
    expect(Math.abs(y! - 128)).toBeLessThan(8);
  });

  test("the rim is a thin light line, brightest on the edges that face the light (top and left)", () => {
    const alpha = (x: number, y: number) => px(rim, x, y)[3]!;
    expect(alpha(20, 20)).toBe(0);
    expect(alpha(20, 5)).toBeGreaterThan(alpha(20, 34) * 2);
    expect(alpha(10, 20)).toBeGreaterThan(alpha(29, 20));
    expect(px(rim, 20, 5).slice(0, 3)).toEqual([255, 255, 255]);
  });

  test("the rim is Phong's highlight, as feSpecularLighting draws it: full where the glass faces the halfway vector, none on flat glass", () => {
    // A slope rising to the right at a steady 26 levels a pixel, lit from the left at 30°: the halfway vector between
    // the light and the viewer leans 30° (45° less half the elevation) towards the light. With a relief that tilts
    // this slope by exactly that much, its normal is the halfway vector, and Phong gives the full strength.
    const w = 12;
    const ramp = new Uint8ClampedArray(w * 4 * 4);
    const solid = new Uint8ClampedArray(w * 4 * 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < w; x++) {
        ramp[(y * w + x) * 4 + 3] = 26 * (x - 1);
        solid[(y * w + x) * 4 + 3] = 255;
      }
    const tilt = Math.tan(Math.PI / 6);
    const relief = (tilt * 255) / 26 / ((1 / 0.4) * 1);
    const facing = rimPixels(
      { width: w, height: 4, shape: solid, lens: ramp, thin: ramp },
      { ...lighting, rimBlur: 1, rimRelief: relief, light: { x: -1, y: 0, elevation: 30 } },
    );
    expect(facing[(1 * w + 5) * 4 + 3]).toBeGreaterThanOrEqual(Math.floor(255 * 0.95) - 2);
    // Lit from the right instead, the same slope faces away: no highlight.
    const away = rimPixels(
      { width: w, height: 4, shape: solid, lens: ramp, thin: ramp },
      { ...lighting, rimBlur: 1, rimRelief: relief, light: { x: 1, y: 0, elevation: 30 } },
    );
    expect(away[(1 * w + 5) * 4 + 3]).toBeLessThan(3);
    // Flat glass, in the middle of a stroke, gets almost nothing from a light this low.
    expect(px(rim, 20, 20)[3]).toBeLessThan(3);
  });

  test("a fill light from the opposite side leaves a faint back rim, so the far edges show too", () => {
    const filled = rimPixels(digit, { ...lighting, rimFill: 0.4 });
    const alpha = (x: number, y: number) => px(filled, x, y)[3]!;
    expect(alpha(20, 34)).toBeGreaterThan(px(rim, 20, 34)[3]! + 20);
    expect(alpha(20, 34)).toBeLessThan(alpha(20, 5));
    expect(alpha(20, 20)).toBe(0);
  });
});
