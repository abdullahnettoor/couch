/**
 * The liquid clock's maps (#37), built from the time's characters once a minute, in a worker (clock-glass-worker.ts):
 *   - a displacement map (R = x, G = y, 128 = none) for the SVG `feDisplacementMap` that runs as the lens's
 *     backdrop-filter, so the Wallpaper behind each digit bends near its edges and stays almost clear in the middle;
 *   - the rim: a thin highlight on the edges that face the light, worked out as SVG's `feSpecularLighting` does it
 *     (Phong's specular term, a distant light, the narrow height map as the surface), over a soft bevel from the lens's
 *     slope. It doesn't depend on the picture behind, so it's computed here once a minute as a still image.
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
  rimShine: number;
  rimRelief: number;
  rimFill: number;
  bevelStrength: number;
  light: Light;
}

/** Where the light comes from: a direction on the Screen (y points down), and its height above it in degrees. */
export interface Light {
  x: number;
  y: number;
  elevation: number;
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
  /** The rim's specular constant, exponent and relief (how far its steepest edge tilts: a tangent). */
  rimStrength: number;
  rimShine: number;
  rimRelief: number;
  /** The specular constant of a fill light opposite the main one (the faint back rim on the far edges). */
  rimFill: number;
  bevelStrength: number;
  light: Light;
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
 * The rim (RGBA, white with a soft shade), inside the digits only, over a soft bevel from the lens's slope. It is
 * two `feSpecularLighting` passes with an `feDistantLight` each, white, added: the narrow height map is the surface,
 * raised `rimRelief` at its steepest, and each pixel gets `strength × (N · H) ^ rimShine`, where N is the surface's
 * normal and H the halfway vector between the light and the viewer. The main light (`rimStrength`) lights the edges
 * facing it; a fill from the opposite side (`rimFill`) leaves a faint back rim on the far edges, so every edge of a digit
 * shows. Low lights leave flat glass dark.
 */
export function rimPixels(heights: Heights, lighting: Lighting): Uint8ClampedArray {
  const { width: w, height: h, shape, thin } = heights;
  const { rimBlur, rimStrength, rimShine, rimRelief, rimFill, bevelStrength, light } = lighting;
  const r = new Uint8ClampedArray(w * h * 4);
  // feSpecularLighting's surfaceScale: the steepest edge a blur this wide makes, tilted by `rimRelief`.
  const surfaceScale = ((rimBlur || 1) / 0.4) * rimRelief;
  const key = halfway(light, 1);
  const fill = halfway(light, -1);
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
      const nx =
        (-surfaceScale * (heightAt(thin, w, h, x + 1, y) - heightAt(thin, w, h, x - 1, y))) / 2;
      const ny =
        (-surfaceScale * (heightAt(thin, w, h, x, y + 1) - heightAt(thin, w, h, x, y - 1))) / 2;
      const n = Math.hypot(nx, ny, 1);
      const phong = (h: Vector, strength: number) => {
        const nh = (nx * h.x + ny * h.y + h.z) / n;
        return nh > 0 && strength > 0 ? strength * nh ** rimShine : 0;
      };
      const rim = Math.min(1, phong(key, rimStrength) + phong(fill, rimFill));
      const alpha = rim + bevel * (1 - rim);
      if (alpha <= 0) continue;
      r[i] = r[i + 1] = r[i + 2] = (255 * rim + bevelColour * bevel * (1 - rim)) / alpha;
      r[i + 3] = alpha * a * 255;
    }
  }
  return r;
}

interface Vector {
  x: number;
  y: number;
  z: number;
}

/** The halfway vector between a distant light (`side` −1: the same light from the opposite side) and the viewer. */
function halfway(light: Light, side: 1 | -1): Vector {
  const elevation = (light.elevation * Math.PI) / 180;
  const along = (Math.hypot(light.x, light.y) || 1) / side;
  const x = (light.x / along) * Math.cos(elevation);
  const y = (light.y / along) * Math.cos(elevation);
  const z = Math.sin(elevation) + 1;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
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
    rimShine: job.rimShine,
    rimRelief: job.rimRelief,
    rimFill: job.rimFill,
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
