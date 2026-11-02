/**
 * The Couch logo as rounded polygons, and the helpers that draw and morph them (tickets 139 and 142).
 *
 * Every shape is a polygon whose corners carry their own radius. The wordmark's U and O share the logo's
 * polygons corner for corner: the U and the sofa have the same eight corners, the O and the Screen's frame
 * the same four outside and four inside. A morph only moves corners and changes radii, so every in-between
 * frame is still a clean rounded shape.
 *
 * The logo is drawn in the hero mark's units: the 832 × 688 crop of Couch's build/icon.png
 * (src/shots/couch-glow.webp), so the vector logo lands exactly on the picture that takes over.
 */

export type Pt = [x: number, y: number];
/** A corner: position and radius. */
export type Corner = [x: number, y: number, r: number];
export type Poly = Corner[];

export const rect = (x0: number, y0: number, x1: number, y1: number, rad: number): Poly => [
  [x0, y0, rad], [x1, y0, rad], [x1, y1, rad], [x0, y1, rad],
];

/** The logo, in mark units (832 × 688, measured from build/icon.png). */
export const MARK = { w: 832, h: 688, cx: 417, base: 620 } as const;
export const logo = {
  /** The sofa: arms, cradle (the seat), base. Same corner order as the wordmark's U. */
  sofa: [
    [84, 342, 56], [200, 342, 56], [200, 490, 44], [635, 490, 44],
    [635, 342, 56], [750, 342, 56], [750, 620, 86], [84, 620, 86],
  ] as Poly,
  /** The Screen's dark frame (outside, inside) and the lit Screen. */
  frame: [rect(226, 188, 607, 455, 40), rect(250, 212, 583, 431, 20).reverse()] as Poly[],
  screen: rect(250, 212, 583, 431, 20),
  /** The sofa's back, behind the Screen. */
  back: rect(139, 173, 694, 540, 86),
};

/** Logo corners → em units, for a wordmark drawn at `s` mark units per em with the U on the sofa. */
export const toEm = (p: Poly, s: number): Poly =>
  p.map(([x, y, rad]) => [(x - MARK.cx) / s, (y - MARK.base) / s, rad / s]);

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** A rounded polygon as an SVG path: every corner a cubic arc (radius clamped to half of each edge). */
export function path(poly: Poly): string {
  const n = poly.length;
  const k = 0.5523; // a quarter circle
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x, y, rad] = poly[i];
    const [px, py] = poly[(i + n - 1) % n];
    const [nx, ny] = poly[(i + 1) % n];
    const lp = Math.hypot(px - x, py - y), ln = Math.hypot(nx - x, ny - y);
    const rr = Math.max(0, Math.min(rad, lp / 2, ln / 2));
    const ax = x + ((px - x) / (lp || 1)) * rr, ay = y + ((py - y) / (lp || 1)) * rr;
    const bx = x + ((nx - x) / (ln || 1)) * rr, by = y + ((ny - y) / (ln || 1)) * rr;
    d += `${i ? "L" : "M"}${f(ax)} ${f(ay)}C${f(ax + (x - ax) * k)} ${f(ay + (y - ay) * k)} ${f(bx + (x - bx) * k)} ${f(by + (y - by) * k)} ${f(bx)} ${f(by)}`;
  }
  return d + "Z";
}

export const paths = (polys: Poly[]) => polys.map(path).join("");

/** Corner-by-corner interpolation of two matching shapes. */
export const mix = (a: Poly, b: Poly, t: number): Poly =>
  a.map(([x, y, rad], i) => [x + (b[i][0] - x) * t, y + (b[i][1] - y) * t, rad + (b[i][2] - rad) * t]);

/** The middle of a shape's box. */
export const centre = (p: Poly): Pt => {
  const xs = p.map((c) => c[0]), ys = p.map((c) => c[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
