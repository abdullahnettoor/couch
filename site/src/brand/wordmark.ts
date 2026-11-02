/**
 * The COUCH wordmark and the Couch logo, as rounded polygons (ticket 139).
 *
 * Every shape is a polygon whose corners carry their own radius. The wordmark and the logo share
 * the same polygons, vertex for vertex: the U and the sofa have the same eight corners, the O and
 * the Screen's frame the same four outside and four inside. A morph only moves corners and changes
 * radii, so every in-between frame is still a clean rounded shape.
 *
 * Letters are drawn in "em" units: cap height 100, baseline y = 0, the U centred on x = 0.
 * The logo is drawn in the hero mark's units: the 832 × 688 crop of Couch's build/icon.png
 * (src/shots/couch-glow.webp), so the vector logo lands exactly on the picture that takes over.
 */

import type { IntroMode } from "../config.ts";

export type Pt = [x: number, y: number];
/** A corner: position and radius. */
export type Corner = [x: number, y: number, r: number];
export type Poly = Corner[];

/** Width of each letter, the gap between letters, and the wordmark's extent (em). */
export const CAP = 100;
/** Gaps: 14 between closed sides, 11 after a C, whose open side and round corners already add air. */
export const WIDTH = 734; // C 132 + 11 + O 140 + 14 + U 140 + 14 + C 132 + 11 + H 140
export const LEFT = -WIDTH / 2;

// Weights, in the "PRO" manner: the horizontal bars carry the weight, counters are slots.
const STEM = 28; // vertical stems
const R = 34; // outer corners
const r = 4; // slot corners

/**
 * Optical sizes. Display: 12-unit slots, as in "PRO". Small (the nav, about 18px tall): slots and notches
 * opened up so they stay at least two device pixels and the letters do not close up into bars.
 */
export type Optical = { slot: number; notch: number };
export const DISPLAY: Optical = { slot: 12, notch: 18 };
export const SMALL: Optical = { slot: 17, notch: 22 };

const rect = (x0: number, y0: number, x1: number, y1: number, rad: number): Poly => [
  [x0, y0, rad], [x1, y0, rad], [x1, y1, rad], [x0, y1, rad],
];

/** C: the O with its slot run out through the right side. */
const C = (x: number, { slot }: Optical): Poly => {
  const w = 132, m = -CAP / 2;
  return [
    [x, -CAP, R], [x + w, -CAP, 26], [x + w, m - slot / 2, 5], [x + STEM, m - slot / 2, r],
    [x + STEM, m + slot / 2, r], [x + w, m + slot / 2, 5], [x + w, 0, 26], [x, 0, R],
  ];
};

/** O: outside and the slot (the slot becomes the Screen). */
const O = (x: number, { slot }: Optical): Poly[] => {
  const w = 140, m = -CAP / 2;
  return [rect(x, -CAP, x + w, 0, R), rect(x + STEM, m - slot / 2, x + w - STEM, m + slot / 2, r).reverse()];
};

/** U: the O without its top bar. Same corners as the sofa: arm, arm, cradle, cradle, arm, arm, base, base. */
const U = ({ slot }: Optical): Poly => {
  const h = 70, bar = (CAP - slot) / 2;
  return [
    [-h, -CAP, 6], [-h + STEM, -CAP, 6], [-h + STEM, -bar, 12], [h - STEM, -bar, 12],
    [h - STEM, -CAP, 6], [h, -CAP, 6], [h, 0, R], [-h, 0, R],
  ];
};

/** H: two heavy stems, a crossbar, the counters as narrow vertical slots. */
const H = (x: number, { notch }: Optical): Poly => {
  const w = 140, c = x + w / 2, n = notch / 2, t = -CAP / 2 - 13, b = -CAP / 2 + 13;
  return [
    [x, -CAP, R], [c - n, -CAP, r], [c - n, t, r], [c + n, t, r], [c + n, -CAP, r], [x + w, -CAP, R],
    [x + w, 0, R], [c + n, 0, r], [c + n, b, r], [c - n, b, r], [c - n, 0, r], [x, 0, R],
  ];
};

/** The five letters at an optical size (em). */
export const draw = (o: Optical) => ({
  c1: [C(LEFT, o)],
  o: O(-224, o),
  u: [U(o)],
  c2: [C(84, o)],
  h: [H(227, o)],
}) satisfies Record<string, Poly[]>;

export const letters = draw(DISPLAY);

/** The logo, in mark units (832 × 688, measured from build/icon.png). */
export const MARK = { w: 832, h: 688, cx: 417, base: 620 } as const;
export const logo = {
  /** The sofa: arms, cradle (the seat), base. Same corner order as U(). */
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

/** The icon's orange, light from above (the "PRO" gradient), as SVG stops. */
export const ORANGE = `<stop offset="0" stop-color="#ffc681"/><stop offset=".55" stop-color="#f28a3a"/><stop offset="1" stop-color="#c9601f"/>`;

/** The static wordmark: one path per letter, em units. */
export function wordmarkSvg(o: { id: string; attrs: string; title?: string; optical?: Optical }): string {
  const label = o.title ? `role="img" aria-labelledby="${o.id}-t"` : `aria-hidden="true" focusable="false"`;
  const title = o.title ? `<title id="${o.id}-t">${o.title}</title>` : "";
  const body = Object.values(draw(o.optical ?? DISPLAY)).map((p) => `<path d="${paths(p)}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LEFT} -${CAP} ${WIDTH} ${CAP}" ${o.attrs} ${label}>${title}<defs><linearGradient id="${o.id}-g" x1="0" y1="0" x2="0" y2="1">${ORANGE}</linearGradient></defs><g fill="url(#${o.id}-g)" fill-rule="evenodd">${body}</g></svg>`;
}

/**
 * The hero intro: the wordmark (em units, placed on the sofa by the CSS transform with --wm-s) over
 * the logo's back and Screen (mark units). The intro script morphs the U and the O; CSS does the rest.
 */
export function introSvg(): string {
  const l = letters;
  const letter = (cls: string, i: number, polys: Poly[]) => `<path class="l ${cls}" style="--i:${i}" d="${paths(polys)}"/>`;
  return `<svg class="wm-intro" viewBox="0 0 ${MARK.w} ${MARK.h}" aria-hidden="true" focusable="false"><defs>`
    + `<linearGradient id="in-g" x1="0" y1="0" x2="0" y2="1">${ORANGE}</linearGradient>`
    + `<linearGradient id="in-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d27536"/><stop offset="1" stop-color="#9c4d1d"/></linearGradient>`
    + `<radialGradient id="in-s" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#fff3e2"/><stop offset=".6" stop-color="#ffdcae"/><stop offset="1" stop-color="#f7b977"/></radialGradient></defs>`
    + `<path class="i-back" fill="url(#in-b)" d="${path(logo.back)}"/>`
    + `<path class="i-screen" fill="url(#in-s)" d="${path(logo.screen)}"/>`
    + `<g class="i-wm" fill="url(#in-g)" fill-rule="evenodd">`
    + letter("l-c1", 0, l.c1) + letter("l-o", 1, l.o) + `<path class="l-o l-o-frame" d="${paths(l.o)}"/>`
    + letter("l-u", 2, l.u) + letter("l-c2", 3, l.c2) + letter("l-h", 4, l.h)
    + `</g></svg>`;
}

/**
 * Runs in <head> before the first paint: once per visit (sessionStorage), never with reduced motion or a
 * #section link, it marks the page for the intro and sizes the wordmark (--wm-s: mark units per em) so it
 * spans min(700px, 88vw) over a mark of min(320px, 62vw, 33vh), the hero mark's CSS size. In the "logo-only"
 * mode (src/config.ts) it also adds html.intro-logo, so the copy is never hidden.
 */
export const introHead = (mode: IntroMode) => `(function(){try{var d=document.documentElement,w=innerWidth,h=innerHeight;`
  + `if(location.hash.length>1||matchMedia("(prefers-reduced-motion: reduce)").matches||sessionStorage.getItem("couch:intro"))return;`
  + `sessionStorage.setItem("couch:intro","1");`
  + `d.style.setProperty("--wm-s",(Math.min(700,.88*w)*${MARK.w}/Math.min(320,.62*w,.33*h)/${WIDTH}).toFixed(3));`
  + `d.classList.add(${mode === "logo-only" ? `"intro","intro-logo"` : `"intro"`})}catch(e){}})();`;
