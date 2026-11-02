/*
 * The hero intro's morph (ticket 139). src/style.css times the intro; this moves the U and the O on the same
 * clock (the CSS animations' start time): the U's corners slide to the sofa's (its arms round into
 * armrests, its base becomes the seat), and the O hops over the arm, drops into the sofa and opens its slot
 * into the Screen. Plain corner interpolation (src/brand/wordmark.ts), one requestAnimationFrame loop for
 * about 0.7s, no library. Any scroll, click, tap or key, or a switch to reduced motion, skips to the end.
 */
import { letters, logo, mix, path, toEm, type Poly } from "./brand/wordmark.ts";

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
const ease = bezier(0.16, 1, 0.3, 1); // Couch's --ease
const inOut = bezier(0.65, 0, 0.35, 1);
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Timing (ms from the start), matching style.css: the C, C and H leave from 660ms and are gone by about 940ms. */
const U_AT = 900, U_FOR = 620;
const O_AT = 800, O_FOR = 760;
const END = 2100; // the vector intro has faded (style.css: out at 1.66s + .4s)

export function intro(reduced: () => boolean, onChange: (fn: () => void) => void) {
  const root = document.documentElement;
  const svg = document.querySelector<SVGSVGElement>("svg.wm-intro");
  if (!root.classList.contains("intro") || !svg) return;
  // The CSS animations' own clock: the intro's start is the start time of the svg's fade-out animation.
  const now = () => Number(document.timeline.currentTime ?? performance.now());
  const clock = svg.getAnimations().find((a) => (a as CSSAnimation).animationName === "intro-out");
  const t0 = clock?.startTime != null ? Number(clock.startTime) : now();
  const s = parseFloat(getComputedStyle(root).getPropertyValue("--wm-s")) || 2.4;
  const u = svg.querySelector<SVGPathElement>(".l-u")!;
  const os = [...svg.querySelectorAll<SVGPathElement>(".l-o")];
  const uA = letters.u[0], uB = toEm(logo.sofa, s);
  const oA = letters.o, oB = logo.frame.map((p) => toEm(p, s));
  const hop = 70 / s + 28; // how far the O lifts over the arm before it drops in (em)

  const draw = (t: number) => {
    u.setAttribute("d", path(mix(uA, uB, ease(clamp((t - U_AT) / U_FOR)))));
    const p = clamp((t - O_AT) / O_FOR);
    const shape = ease(p), x = inOut(p), lift = Math.sin(Math.PI * Math.min(1, p * 1.15)) * hop;
    const d = oA.map((a, i) => {
      const b = oB[i];
      return path(a.map(([ax, ay, ar], k): Poly[number] => {
        const [bx, by, br] = b[k];
        // the slot (Screen) and the outline grow with `shape`; the whole O travels with `x` and hops with `lift`
        return [ax + (bx - ax) * x, ay + (by - ay) * shape - lift, ar + (br - ar) * shape];
      }));
    }).join("");
    os.forEach((o) => o.setAttribute("d", d));
  };

  let raf = 0, over = false;
  const events = ["wheel", "touchstart", "pointerdown", "keydown", "scroll"] as const;
  const end = (skipped: boolean) => {
    if (over) return;
    over = true;
    cancelAnimationFrame(raf);
    events.forEach((e) => removeEventListener(e, onInput, true));
    draw(Infinity);
    if (!skipped) { root.classList.add("intro-done"); return; }
    root.classList.add("intro-skip");
    setTimeout(() => root.classList.add("intro-done"), 260);
  };
  const onInput = () => end(true);
  const frame = () => {
    const t = now() - t0;
    draw(t);
    raf = t < O_AT + O_FOR ? requestAnimationFrame(frame) : 0;
  };
  events.forEach((e) => addEventListener(e, onInput, { capture: true, passive: true }));
  onChange(() => { if (reduced()) end(true); });

  if (scrollY > 0 || reduced()) return end(true);
  if (now() - t0 >= END) return end(false);
  raf = requestAnimationFrame(frame);
  if (clock) clock.finished.then(() => end(false), () => {});
  else setTimeout(() => end(false), END - (now() - t0));
}
