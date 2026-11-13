// The Couch mark's framing: the sofa cut out of the app icon, cropped to what shows and padded to a square.
import type { Rgba } from "../look-diff.ts";

/** Crops `image` to its pixels that aren't fully transparent and centres them in a transparent square, `margin` px clear of the longer side. */
export function cropToMark(image: Rgba, margin: number): Rgba {
  const { width, height, data } = image;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < 0) throw new Error("the picture is fully transparent");
  const [w, h] = [right - left + 1, bottom - top + 1];
  const side = Math.max(w, h) + margin * 2;
  const [padX, padY] = [Math.floor((side - w) / 2), Math.floor((side - h) / 2)];
  const out = new Uint8Array(side * side * 4);
  for (let y = 0; y < h; y++)
    out.set(
      data.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4),
      ((padY + y) * side + padX) * 4,
    );
  return { width: side, height: side, data: out };
}
