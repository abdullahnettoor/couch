/**
 * The liquid clock's maps (#37), built from the time's characters once a minute, in a worker (clock-glass-worker.ts):
 *   - a displacement map (R = x, G = y, 128 = none) for the SVG `feDisplacementMap` that runs as the lens's
 *     backdrop-filter, so the Wallpaper behind each digit bends near its edges and stays almost clear in the middle;
 *   - the rim: a thin highlight lit from the light's side, with a faint back rim and a soft bevel from the lens's
 *     slope. It doesn't depend on the picture behind, so it's a still image.
 * Both come from height maps: the digits drawn solid, and blurred wide (the lens's slope) and narrow (the rim's).
 */

/** One character of the time, where the DOM laid it out (relative to the time's box). */
export interface MapGlyph {
  ch: string;
  x: number;
  y: number;
  /** Its font, as a canvas font. */
  font: string;
}

/** What the worker is asked to draw. Lengths are CSS pixels; `scale` is the maps' share of them. */
export interface MapJob {
  glyphs: MapGlyph[];
  pad: number;
  width: number;
  height: number;
  scale: number;
  lensBlur: number;
  rimBlur: number;
  rimStrength: number;
  bevelStrength: number;
  light: { x: number; y: number };
}

/** The two maps as PNG data URLs (blob URLs don't load under the Screen's file://). */
export interface Maps {
  displacement: string;
  rim: string;
}

/** The digits' height maps (RGBA, the height in alpha), all `width` × `height`. */
export interface Heights {
  width: number;
  height: number;
  /** The digits drawn solid. */
  shape: Uint8ClampedArray;
  /** Blurred `lensBlur` pixels: the lens's slope. */
  lens: Uint8ClampedArray;
  /** Blurred `rimBlur` pixels: the rim's edge. */
  thin: Uint8ClampedArray;
}

export interface Lighting {
  /** The blurs the heights were drawn with, in map pixels: they set how steep a slope counts as the steepest. */
  lensBlur: number;
  rimBlur: number;
  /** How far apart (map pixels) the lens's slope is sampled: a few pixels, for a smooth bend. */
  step: number;
  rimStrength: number;
  bevelStrength: number;
  light: { x: number; y: number };
}

/** The alpha (0 to 1) of `d` at (x, y), clamped to its edges. */
const heightAt = (d: Uint8ClampedArray, w: number, h: number, x: number, y: number) =>
  d[((y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)) * 4 + 3]! / 255;

/** The lens's slope at (x, y): it points up the height map, into the digit, about 1 at its steepest. */
function slope(
  { width: w, height: h, lens }: Heights,
  { lensBlur, step: k }: Lighting,
  x: number,
  y: number,
) {
  // About the steepest slope a blur this wide makes, brought to 1.
  const gain = (lensBlur || 1) / 0.4;
  return {
    x: ((heightAt(lens, w, h, x + k, y) - heightAt(lens, w, h, x - k, y)) / (2 * k)) * gain,
    y: ((heightAt(lens, w, h, x, y + k) - heightAt(lens, w, h, x, y - k)) / (2 * k)) * gain,
  };
}

/**
 * The displacement map (RGBA; R = x, G = y, 128 = none). Near an edge the picture is drawn from further inside the
 * digit, which magnifies the edge; in the middle of a stroke (no slope) it is left alone.
 */
export function displacementPixels(heights: Heights, lighting: Lighting): Uint8ClampedArray {
  const { width: w, height: h, shape } = heights;
  const m = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = shape[i + 3]! / 255;
      m[i + 3] = 255;
      if (a === 0) {
        m[i] = m[i + 1] = m[i + 2] = 128;
        continue;
      }
      const g = slope(heights, lighting, x, y);
      m[i] = 128 + Math.max(-127, Math.min(127, g.x * 127 * a));
      m[i + 1] = 128 + Math.max(-127, Math.min(127, g.y * 127 * a));
      m[i + 2] = 128;
    }
  }
  return m;
}

/**
 * The rim (RGBA, white with a soft shade): a thin highlight where the narrow height map slopes, brightest on edges
 * that face the light, with a faint back rim on the far side, over a soft bevel from the lens's slope.
 */
export function rimPixels(heights: Heights, lighting: Lighting): Uint8ClampedArray {
  const { width: w, height: h, shape, thin } = heights;
  const { rimBlur, rimStrength, bevelStrength, light } = lighting;
  const r = new Uint8ClampedArray(w * h * 4);
  const rimNorm = (rimBlur || 1) / 0.4;
  const bevelShade = bevelStrength * 0.8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = shape[i + 3]! / 255;
      if (a === 0) continue;
      // The bevel: the lens's slope lit from the light (a soft highlight on the lit side, a soft shade on the far one).
      let bevelColour = 0;
      let bevel = 0;
      if (bevelStrength > 0) {
        const g = slope(heights, lighting, x, y);
        const gm = Math.hypot(g.x, g.y);
        if (gm > 1e-4) {
          const facing = ((-g.x / gm) * light.x + (-g.y / gm) * light.y) * Math.min(1, gm);
          bevelColour = facing > 0 ? 255 : 0;
          bevel = facing > 0 ? facing * bevelStrength : -facing * bevelShade;
        }
      }
      const tx = (heightAt(thin, w, h, x + 1, y) - heightAt(thin, w, h, x - 1, y)) / 2;
      const ty = (heightAt(thin, w, h, x, y + 1) - heightAt(thin, w, h, x, y - 1)) / 2;
      const mag = Math.hypot(tx, ty);
      let rim = 0;
      if (mag > 1e-4) {
        const edge = Math.min(1, mag * rimNorm);
        // The outward normal points down the slope.
        const facing = (-tx / mag) * light.x + (-ty / mag) * light.y;
        const lit = 0.14 + 0.86 * Math.max(0, facing) ** 1.4 + 0.28 * Math.max(0, -facing);
        rim = Math.min(1, edge * lit * rimStrength);
      }
      const alpha = rim + bevel * (1 - rim);
      if (alpha <= 0) continue;
      r[i] = r[i + 1] = r[i + 2] = (255 * rim + bevelColour * bevel * (1 - rim)) / alpha;
      r[i + 3] = alpha * a * 255;
    }
  }
  return r;
}

/**
 * Draws the digits and builds both maps, encoded. The displacement map is drawn at `scale` (the bend is smooth, so
 * half resolution looks the same); the rim at full resolution, where its thin line stays sharp. Needs OffscreenCanvas
 * (a worker or the page).
 */
export async function buildMaps(job: MapJob): Promise<Maps> {
  const heights = (scale: number, blurs: number[]) => {
    const w = Math.max(1, Math.round(job.width * scale));
    const h = Math.max(1, Math.round(job.height * scale));
    const draw = (blur: number) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      if (blur > 0) ctx.filter = `blur(${blur * scale}px)`;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const g of job.glyphs) {
        ctx.font = g.font;
        ctx.fillText(g.ch, job.pad + g.x, job.pad + g.y);
      }
      return ctx.getImageData(0, 0, w, h).data;
    };
    const [lens, thin] = blurs.map(draw);
    return { width: w, height: h, shape: draw(0), lens: lens!, thin: thin ?? lens! };
  };
  const lighting = (scale: number): Lighting => ({
    lensBlur: job.lensBlur * scale,
    rimBlur: job.rimBlur * scale,
    // Sampled about a seventh of the slope apart (1.5 px at 1920 × 1080), for a smooth bend.
    step: Math.max(1, Math.round(job.lensBlur * scale * 0.15)),
    rimStrength: job.rimStrength,
    bevelStrength: job.bevelStrength,
    light: job.light,
  });
  const lens = heights(job.scale, [job.lensBlur]);
  const displacement = displacementPixels(lens, lighting(job.scale));
  const sharp = heights(1, [job.lensBlur, job.rimBlur]);
  const rim = rimPixels(sharp, lighting(1));
  const [d, r] = await Promise.all([
    png(displacement, lens.width, lens.height),
    png(rim, sharp.width, sharp.height),
  ]);
  return { displacement: d, rim: r };
}

async function png(pixels: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const canvas = new OffscreenCanvas(w, h);
  canvas
    .getContext("2d")!
    .putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const bytes = new Uint8Array(
    await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
  );
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}
