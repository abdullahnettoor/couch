// Writes src/brand/korataki.ts: COUCH from Korataki ExtraBold's outlines (Typodermic), as SVG paths and corners.
//   node scripts/korataki.mjs <font.ttf|otf>          write it (or KORATAKI_FONT=<font> node scripts/korataki.mjs)
//   node scripts/korataki.mjs <font> --check          exit 1 if the committed file differs from this font's outlines
// The font is a paid font and is never committed (see the README, "Before publishing"): keep it outside the repo
// and pass its path. Only the outlines ship, as paths in the generated file.
//
// C, C and H are the font's own outlines (its quadratic curves, as they are). U and O are traced as rounded
// polygons: every quadratic corner becomes a corner whose radius is the mean of its two legs (the font's corners are
// slightly elliptical; these are circular, a hair rounder), every sharp corner keeps radius 0. The corners are put
// in the logo's order (src/brand/logo.ts), so the U morphs into the sofa and the O into the Screen's frame.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";
import { logo } from "../src/brand/logo.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const fontPath = args.find((a) => !a.startsWith("--")) ?? process.env.KORATAKI_FONT;
if (!fontPath) {
  console.error("korataki: pass the font file (Korataki ExtraBold, .ttf or .otf) as an argument or in KORATAKI_FONT");
  process.exit(2);
}
const buf = readFileSync(fontPath);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const capUnits = font.tables.os2.sCapHeight || font.unitsPerEm * 0.8;
const k = 100 / capUnits; // em: cap height 100, baseline 0, y down

const r2 = (n) => Math.round(n * 100) / 100;
const word = "COUCH", keys = ["c1", "o", "u", "c2", "h"];
const glyphs = [...word].map((ch) => font.charToGlyph(ch));
let pen = 0;
const placed = glyphs.map((g) => { const x = pen; pen += g.advanceWidth; return { g, x, box: g.getBoundingBox() }; });
const u = placed[2];
const uCx = u.x + (u.box.x1 + u.box.x2) / 2;
const X = (x, off) => r2((x + off - uCx) * k);
const Y = (y) => r2(-y * k);

/** A glyph's contours: lists of on-curve points and quadratic controls (font units, y up). */
function contours(g) {
  const out = [];
  let cur;
  for (const c of g.path.commands) {
    if (c.type === "M") { cur = [{ x: c.x, y: c.y }]; out.push(cur); }
    else if (c.type === "L") cur.push({ x: c.x, y: c.y });
    else if (c.type === "Q") cur.push({ x: c.x1, y: c.y1, ctrl: true }, { x: c.x, y: c.y });
    else if (c.type === "C") throw new Error(`korataki: ${g.name} has a cubic curve; expected TrueType quadratics`);
  }
  // drop zero-length steps, and the closing point that repeats the first
  return out.map((pts) => pts.filter((p, i) => {
    const q = pts[(i + pts.length - 1) % pts.length];
    return p.ctrl || q.ctrl || p.x !== q.x || p.y !== q.y;
  }));
}

/** An outline as an SVG path, in em, placed at its advance. */
function outlinePath(g, off) {
  return contours(g).map((pts) => {
    let d = `M${X(pts[0].x, off)} ${Y(pts[0].y)}`;
    for (let i = 1; i <= pts.length; i++) {
      const p = pts[i % pts.length];
      if (p.ctrl) { const q = pts[(i + 1) % pts.length]; d += `Q${X(p.x, off)} ${Y(p.y)} ${X(q.x, off)} ${Y(q.y)}`; i++; }
      else if (i < pts.length) d += `L${X(p.x, off)} ${Y(p.y)}`;
    }
    return d + "Z";
  }).join("");
}

/** A contour as corners [x, y, r] (em): quadratic controls are round corners, line-to-line turns are sharp. */
function corners(pts, off) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    if (p.ctrl) {
      out.push([X(p.x, off), Y(p.y), r2(((Math.hypot(p.x - a.x, p.y - a.y) + Math.hypot(p.x - b.x, p.y - b.y)) / 2) * k)]);
    } else if (!a.ctrl && !b.ctrl) {
      const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
      if (Math.abs(cross) > 1e-6) out.push([X(p.x, off), Y(p.y), 0]);
    }
  }
  return out;
}

/** Rotates or reverses `src` so its corners line up with `ref` (both compared inside their own boxes). */
function align(src, ref) {
  if (src.length !== ref.length) throw new Error(`korataki: ${src.length} corners where the logo has ${ref.length}`);
  const norm = (p) => {
    const xs = p.map((c) => c[0]), ys = p.map((c) => c[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    return p.map(([x, y]) => [(x - x0) / w, (y - y0) / h]);
  };
  const a = norm(src), b = norm(ref), n = src.length;
  let best, bestCost = Infinity;
  for (const dir of [1, -1]) for (let r = 0; r < n; r++) {
    const idx = b.map((_, i) => (((r + dir * i) % n) + n) % n);
    const cost = idx.reduce((s, j, i) => s + (a[j][0] - b[i][0]) ** 2 + (a[j][1] - b[i][1]) ** 2, 0);
    if (cost < bestCost) { bestCost = cost; best = idx.map((j) => src[j]); }
  }
  if (bestCost > 0.5) throw new Error(`korataki: the traced corners do not match the logo's (cost ${bestCost.toFixed(2)})`);
  return best;
}

const out = {};
placed.forEach(({ g, x }, i) => { out[keys[i]] = outlinePath(g, x); });
const uPoly = align(corners(contours(u.g)[0], u.x), logo.sofa);
const o = placed[1], oc = contours(o.g);
if (oc.length !== 2) throw new Error("korataki: expected the O to have two contours");
const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0));
const [outer, inner] = [...oc].sort((p, q) => area(q) - area(p));
const oPolys = [align(corners(outer, o.x), logo.frame[0]), align(corners(inner, o.x), logo.frame[1])];

const first = placed[0], last = placed[4];
const left = X(first.box.x1, first.x), right = X(last.box.x2, last.x);
const sha = createHash("sha256").update(buf).digest("hex");
const name = font.getEnglishName("fullName"), version = font.getEnglishName("version");
const json = (v) => JSON.stringify(v);
const file = `// Generated by scripts/korataki.mjs from ${name} (${version}, sha256 ${sha.slice(0, 16)}…). Do not edit.
// COUCH from the font's outlines, in em units: cap height 100, baseline y = 0, the U centred on x = 0.
// C, C and H are the font's own outlines. U and O are the font's shapes traced as corners [x, y, radius],
// in the logo's corner order (src/brand/logo.ts). The font itself is not in this repository.
import type { Poly } from "./logo.ts";

export const SOURCE = { font: ${json(name)}, version: ${json(version)}, sha256: ${json(sha)} } as const;
/** The wordmark's ink, left to right (em). */
export const LEFT = ${left};
export const WIDTH = ${r2(right - left)};

export const C1 = ${json(out.c1)};
export const C2 = ${json(out.c2)};
export const H = ${json(out.h)};
/** The O, outside and inside (the inside becomes the Screen). */
export const O: Poly[] = ${json(oPolys)};
/** The U, with the sofa's eight corners. */
export const U: Poly = ${json(uPoly)};
`;

const target = new URL("../src/brand/korataki.ts", import.meta.url);
if (check) {
  let current = "";
  try { current = readFileSync(target, "utf8"); } catch { /* missing */ }
  if (current !== file) { console.error("korataki: src/brand/korataki.ts differs from this font's outlines; run node scripts/korataki.mjs <font>"); process.exit(1); }
  console.log("korataki: ok");
} else {
  writeFileSync(target, file);
  console.log(`wrote src/brand/korataki.ts from ${name} ${version}`);
}
