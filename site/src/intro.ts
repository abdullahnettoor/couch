/*
 * The hero intro's morph (tickets 139 and 142). src/style.css times the intro; this runs on the same clock (the
 * CSS animations' start time) and does what CSS cannot: the C, C and H dissolve into soft warm dust that drifts
 * into the Screen (a small canvas, only while the intro plays), the O glides in behind the U's arm and settles
 * as the Screen's frame, and the U widens into the sofa. Plain corner interpolation (src/brand/logo.ts), one
 * requestAnimationFrame loop for about 1.5s, no library. Any scroll, click, tap, key, focus, resize or rotation,
 * or a switch to reduced motion, skips to the end; a return from the back/forward cache shows the end at once.
 * The listeners and the canvas go when it ends.
 */
import { LEFT, ORANGE_STOPS, WIDTH, letters } from "./brand/wordmark.ts";
import { MARK, centre, logo, mix, path, toEm, type Poly } from "./brand/logo.ts";

/** cubic-bezier(x1, y1, x2, y2) as a function of time (bisection on x; the curves here are monotonic in x). */
const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const c = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 22; i++) { t = (lo + hi) / 2; if (c(x1, x2, t) < x) lo = t; else hi = t; }
    return c(y1, y2, t);
  };
};
const glide = bezier(0.45, 0, 0.2, 1); // a slow start and Couch's long settle
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const seg = (t: number, at: number, len: number) => clamp((t - at) / len);
const smooth = (v: number) => v * v * (3 - 2 * v);

/** Timing (ms from the start), matching style.css ("Hero intro"). */
export const TIMES = {
  dust: [480, 620], // the C, C and H dissolve, outward from the U (the H a little later)
  o: [520, 800], // the O glides to the Screen's place
  oShape: [700, 620], // and becomes the frame
  u: [640, 660], // the U widens into the sofa
  arrive: 1500, // all dust is in the Screen by now (it lights from 1.28s)
  end: 2100, // the vector intro has faded (style.css: out at 1.62s + .4s)
} as const;

/** A small seeded random, so every visit (and every frame capture) draws the same dust. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Smooth value noise in [0, 1]. */
const hash = (i: number, j: number) => {
  let h = (i * 374761393 + j * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x: number, y: number) => {
  const i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const noise = (x: number, y: number) => 0.55 * vnoise(x / 6, y / 6) + 0.45 * vnoise(x / 2.2 + 40, y / 2.2 + 17);

type Mote = {
  x: number; y: number; born: number; life: number; tx: number; ty: number;
  c1x: number; c1y: number; c2x: number; c2y: number; r: number; a: number; warm: boolean; ph: number; sway: number;
};

/**
 * The dust: the C, C and H drawn once into a canvas, then eaten away along a noisy front that moves outward
 * from the U; each mote leaves where its piece of letter went and drifts, slow and soft, into the Screen.
 */
function dust(mark: HTMLElement, s: number) {
  const box = mark.getBoundingClientRect();
  const m = box.width / MARK.w; // px per mark unit
  const em = s * m; // px per em
  const dpr = Math.min(2, devicePixelRatio || 1);
  const pad = 28;
  // the canvas covers the wordmark and the Screen above it, in px relative to the mark
  const x0 = (MARK.cx + LEFT * s) * m - pad, x1 = (MARK.cx + (LEFT + WIDTH) * s) * m + pad;
  const y0 = Math.min(0, (MARK.base - 100 * s) * m) - pad, y1 = MARK.base * m + pad;
  const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
  const canvas = document.createElement("canvas");
  canvas.className = "wm-dust";
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.cssText = `left:${x0.toFixed(1)}px;top:${y0.toFixed(1)}px;width:${w}px;height:${h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // em → canvas px
  const ox = MARK.cx * m - x0, oy = MARK.base * m - y0;
  const X = (x: number) => ox + x * em, Y = (y: number) => oy + y * em;

  // the letters, once, at device resolution
  const lx = Math.floor(X(LEFT) * dpr) - 2, ly = Math.floor(Y(-100) * dpr) - 2;
  const lw = Math.ceil(WIDTH * em * dpr) + 4, lh = Math.ceil(100 * em * dpr) + 4;
  const lc = document.createElement("canvas");
  lc.width = lw; lc.height = lh;
  const lctx = lc.getContext("2d", { willReadFrequently: true })!;
  lctx.setTransform(em * dpr, 0, 0, em * dpr, ox * dpr - lx, oy * dpr - ly);
  const grad = lctx.createLinearGradient(0, -100, 0, 0);
  for (const [o, c] of ORANGE_STOPS) grad.addColorStop(o, c);
  lctx.fillStyle = grad;
  const parts = [["c1", letters.c1], ["c2", letters.c2], ["h", letters.h]] as const;
  for (const [, d] of parts) lctx.fill(new Path2D(d));
  const img = lctx.getImageData(0, 0, lw, lh);
  const px = img.data, orig = px.slice();

  // where each letter sits (canvas px), for the direction of the front
  const span = (d: string) => {
    const xs = [...d.matchAll(/[MLQ](-?[\d.]+) /g)].map((v) => X(Number(v[1])));
    return [Math.min(...xs), Math.max(...xs)];
  };
  const spans = parts.map(([key, d]) => ({ key, x: span(d) }));
  const delay = { c2: 0, c1: 0.06, h: 0.12 } as const;
  const band = 0.05;

  // a threshold per covered pixel: dissolved once progress passes it
  const cover: number[] = [], th: number[] = [];
  for (let j = 0, n = lw * lh; j < n; j++) {
    if (orig[j * 4 + 3] === 0) continue;
    const cx = (lx + (j % lw)) / dpr, cy = (ly + Math.floor(j / lw)) / dpr;
    const l = spans.find((v) => cx >= v.x[0] - 1 && cx <= v.x[1] + 1) ?? spans[0];
    const along = l.key === "c1" ? (l.x[1] - cx) / (l.x[1] - l.x[0]) : (cx - l.x[0]) / (l.x[1] - l.x[0]);
    cover.push(j);
    th.push(delay[l.key] + (1 - 0.12 - band) * (0.68 * clamp(along) + 0.32 * noise(cx / em, cy / em)));
  }

  // the motes: fewer, smaller and warmer than sparks; they lift a little, sway, then settle into the Screen
  const rnd = seeded(142);
  const [dAt, dFor] = TIMES.dust;
  const [sx, sy] = centre(logo.screen).map((v, i) => (i ? v * m - y0 : v * m - x0));
  const sw = (logo.screen[1][0] - logo.screen[0][0]) * m, sh = (logo.screen[2][1] - logo.screen[0][1]) * m;
  const count = Math.round(Math.min(260, Math.max(100, WIDTH * em * 0.34)));
  const motes: Mote[] = [];
  for (let i = 0; i < count && cover.length; i++) {
    const k = Math.floor(rnd() * cover.length), j = cover[k];
    const x = (lx + (j % lw)) / dpr, y = (ly + Math.floor(j / lw)) / dpr;
    const born = dAt + th[k] * dFor;
    const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
    const tx = sx + Math.cos(ang) * rr * sw * 0.42, ty = sy + Math.sin(ang) * rr * sh * 0.4;
    const life = Math.max(380, Math.min(720 + rnd() * 380, TIMES.arrive - born));
    motes.push({
      x, y, born, life, tx, ty,
      c1x: x + (rnd() - 0.5) * 40 * (em / 0.9), c1y: y - (14 + rnd() * 34) * (em / 0.9),
      c2x: tx + (x - tx) * (0.25 + rnd() * 0.3), c2y: ty - (rnd() - 0.3) * 50 * (em / 0.9),
      r: 0.55 + rnd() ** 2 * 1.1, a: 0.3 + rnd() * 0.4, warm: rnd() < 0.6, ph: rnd() * 6.283, sway: 1.5 + rnd() * 4,
    });
  }

  // two soft sprites: amber and cream
  const sprite = (rgb: string) => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, `rgba(${rgb},1)`); r.addColorStop(0.3, `rgba(${rgb},.5)`); r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r; g.fillRect(0, 0, 32, 32);
    return c;
  };
  const amber = sprite("255,196,140"), cream = sprite("255,232,204");

  let lastP = -1, lettersGone = false;
  const draw = (t: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const p = (t - dAt) / dFor;
    if (!lettersGone) {
      if (p !== lastP) {
        for (let i = 0; i < cover.length; i++) {
          const q = cover[i] * 4, v = th[i];
          if (v >= p) { px[q + 3] = orig[q + 3]; continue; }
          if (v < p - band) { px[q + 3] = 0; continue; }
          const e = (p - v) / band; // 0 at the front, 1 where it is gone: a soft warm edge, not an ember
          px[q] = orig[q] + (255 - orig[q]) * e * 0.7; px[q + 1] = orig[q + 1] + (214 - orig[q + 1]) * e * 0.7;
          px[q + 2] = orig[q + 2] + (170 - orig[q + 2]) * e * 0.7; px[q + 3] = orig[q + 3] * (1 - e) * 0.85;
        }
        lctx.putImageData(img, 0, 0);
        lastP = p;
      }
      ctx.drawImage(lc, lx, ly);
      if (p > 1 + band) lettersGone = true;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const q of motes) {
      const u = (t - q.born) / q.life;
      if (u <= 0 || u >= 1) continue;
      const e = glide(u), v = 1 - e;
      const bx = v * v * v * q.x + 3 * v * v * e * q.c1x + 3 * v * e * e * q.c2x + e * e * e * q.tx;
      const by = v * v * v * q.y + 3 * v * v * e * q.c1y + 3 * v * e * e * q.c2y + e * e * e * q.ty;
      const sway = Math.sin(Math.PI * u) * q.sway;
      const x = bx + Math.sin(u * 5 + q.ph) * sway, y = by + Math.cos(u * 4 + q.ph) * sway * 0.5;
      ctx.globalAlpha = q.a * smooth(clamp(u / 0.15)) * (1 - smooth(clamp((u - 0.7) / 0.3)));
      const r = q.r * 3;
      ctx.drawImage(q.warm ? amber : cream, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
  return { canvas, draw };
}

export function intro(reduced: () => boolean, onChange: (fn: () => void) => () => void) {
  const root = document.documentElement;
  const svg = document.querySelector<SVGSVGElement>("svg.wm-intro");
  const mark = svg?.parentElement;
  if (!root.classList.contains("intro") || !svg || !mark) return;
  // The CSS animations' own clock: the intro's start is the start time of the svg's fade-out animation.
  const now = () => Number(document.timeline.currentTime ?? performance.now());
  const clock = svg.getAnimations().find((a) => (a as CSSAnimation).animationName === "intro-out");
  const t0 = clock?.startTime != null ? Number(clock.startTime) : now();
  const s = parseFloat(getComputedStyle(root).getPropertyValue("--wm-s")) || 2.4;
  const u = svg.querySelector<SVGPathElement>(".l-u")!;
  const os = [...svg.querySelectorAll<SVGPathElement>(".l-o")];
  const uA = letters.u[0], uB = toEm(logo.sofa, s);
  const oA = letters.o, oB = logo.frame.map((p) => toEm(p, s));
  const rel = (polys: Poly[], [cx, cy]: [number, number]): Poly[] => polys.map((p) => p.map(([x, y, r]) => [x - cx, y - cy, r]));
  const oc0 = centre(oA[0]), oc1 = centre(oB[0]);
  const oA0 = rel(oA, oc0), oB0 = rel(oB, oc1);
  // the O's path: a shallow dip as it passes behind the U's arm, then up into the sofa's back
  const ctrl = [oc0[0] + (oc1[0] - oc0[0]) * 0.6, oc0[1] + 18];

  const shapes = (t: number) => {
    u.setAttribute("d", path(mix(uA, uB, glide(seg(t, ...TIMES.u)))));
    const e = glide(seg(t, ...TIMES.o)), v = 1 - e, k = glide(seg(t, ...TIMES.oShape));
    const cx = v * v * oc0[0] + 2 * v * e * ctrl[0] + e * e * oc1[0], cy = v * v * oc0[1] + 2 * v * e * ctrl[1] + e * e * oc1[1];
    const d = oA0.map((p, i) => path(mix(p, oB0[i], k).map(([x, y, r]) => [x + cx, y + cy, r]))).join("");
    os.forEach((o) => o.setAttribute("d", d));
  };

  let raf = 0, over = false, offChange = () => {};
  let motes: ReturnType<typeof dust> = null;
  const [dAt, dFor] = TIMES.dust;
  // The dust starts only if the intro is early enough to show it; otherwise the CSS fade takes the letters.
  if (now() - t0 < dAt + dFor * 0.5) {
    motes = dust(mark, s);
    if (motes) { mark.append(motes.canvas); svg.classList.add("dust"); }
  }
  // Anything that reaches the hero skips: scroll, wheel, tap, key, and also a click or focus that comes without a
  // pointer (assistive tech, element.click(), focus()), so no control is ever used while it is still transparent.
  // A resize or rotation skips too: the wordmark was sized for the first viewport (--wm-s).
  const inputs = ["wheel", "touchstart", "pointerdown", "keydown", "scroll", "click", "focusin"] as const;
  const sizes = ["resize", "orientationchange"] as const;
  const end = (how: "played" | "skipped" | "now") => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    inputs.forEach((e) => removeEventListener(e, onInput, true));
    sizes.forEach((e) => removeEventListener(e, onInput));
    removeEventListener("pageshow", onShow);
    offChange();
    motes?.canvas.remove();
    motes = null;
    shapes(Infinity);
    if (how === "played") { root.classList.add("intro-done"); return; }
    if (how === "now") { root.classList.add("intro-skip", "intro-now", "intro-done"); return; }
    root.classList.add("intro-skip");
    setTimeout(() => root.classList.add("intro-done"), 260);
  };
  const onInput = () => end("skipped");
  // back from the back/forward cache: no intro left to watch, the end state at once
  const onShow = (e: PageTransitionEvent) => { if (e.persisted) end("now"); };
  const last = Math.max(TIMES.arrive, TIMES.o[0] + TIMES.o[1], TIMES.u[0] + TIMES.u[1]);
  const frame = () => {
    const t = now() - t0;
    shapes(t);
    if (motes && t >= dAt) {
      svg.classList.add("dusting");
      motes.draw(t);
      if (t >= TIMES.arrive) { motes.canvas.remove(); motes = null; }
    }
    raf = t < last ? requestAnimationFrame(frame) : 0;
  };
  inputs.forEach((e) => addEventListener(e, onInput, { capture: true, passive: true }));
  sizes.forEach((e) => addEventListener(e, onInput, { passive: true }));
  addEventListener("pageshow", onShow);
  offChange = onChange(() => { if (reduced()) end("skipped"); });

  if (scrollY > 0 || reduced()) return end("skipped");
  if (now() - t0 >= TIMES.end) return end("played");
  raf = requestAnimationFrame(frame);
  if (clock) clock.finished.then(() => end("played"), () => {});
  else setTimeout(() => end("played"), TIMES.end - (now() - t0));
}
