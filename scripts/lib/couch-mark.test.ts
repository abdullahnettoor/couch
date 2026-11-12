import { describe, expect, it } from "vite-plus/test";
import { cropToMark } from "./couch-mark.mts";

/** A transparent picture with an opaque block, its pixels coloured by position so a misplaced crop shows. */
function picture(
  width: number,
  height: number,
  block: { x: number; y: number; w: number; h: number },
) {
  const data = new Uint8Array(width * height * 4);
  for (let y = block.y; y < block.y + block.h; y++)
    for (let x = block.x; x < block.x + block.w; x++) data.set([x, y, 7, 255], (y * width + x) * 4);
  return { width, height, data };
}

describe("cropToMark", () => {
  it("crops to the visible pixels and centres them in a transparent square with the margin around the longer side", () => {
    const out = cropToMark(picture(6, 5, { x: 2, y: 1, w: 2, h: 1 }), 1);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    const px = (x: number, y: number) =>
      Array.from(out.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(1, 1)).toEqual([2, 1, 7, 255]);
    expect(px(2, 1)).toEqual([3, 1, 7, 255]);
    expect(px(0, 1)).toEqual([0, 0, 0, 0]);
    expect(px(1, 2)).toEqual([0, 0, 0, 0]);
  });

  it("keeps faint pixels: anything not fully transparent is part of the mark", () => {
    const image = picture(5, 5, { x: 2, y: 2, w: 1, h: 1 });
    image.data.set([9, 9, 9, 1], (1 * 5 + 1) * 4);
    const out = cropToMark(image, 0);
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(Array.from(out.data.subarray(0, 4))).toEqual([9, 9, 9, 1]);
  });

  it("frames the approved mark: the sofa's 670 × 452 px, 10 px clear, is a 690 px square", () => {
    const out = cropToMark(picture(1024, 1024, { x: 175, y: 285, w: 670, h: 452 }), 10);
    expect([out.width, out.height]).toEqual([690, 690]);
    const alpha = (x: number, y: number) => out.data[(y * 690 + x) * 4 + 3];
    expect([alpha(10, 119), alpha(679, 570)]).toEqual([255, 255]);
    expect([alpha(9, 119), alpha(10, 118), alpha(680, 570), alpha(679, 571)]).toEqual([0, 0, 0, 0]);
  });
});
