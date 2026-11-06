/**
 * The COUCH wordmark (ticket 142), from the letters in ./letters.ts. C, C and H are paths; U and O are rounded
 * polygons with the logo's corners (./logo.ts), so the U can widen into the sofa and the O settle as the Screen's
 * frame. Letters are in em units: cap height 100, baseline y = 0, the U centred on x = 0. No font ships.
 */

import type { IntroMode } from "../config.ts";
import { C1, C2, H, LEFT, O, U, WIDTH } from "./letters.ts";
import { MARK, logo, path, paths, type Poly } from "./logo.ts";

export { LEFT, WIDTH };
export const CAP = 100;

/** The five letters: outlines (C, C, H) and morphable corners (O, U). */
export const letters = { c1: C1, o: O, u: [U], c2: C2, h: H } satisfies Record<string, string | Poly[]>;

/** Each letter as an SVG path. */
export const letterPaths = () => ({
  c1: letters.c1, o: paths(letters.o), u: paths(letters.u), c2: letters.c2, h: letters.h,
});

/** The icon's orange, light from above (the "PRO" gradient), as SVG stops. */
export const ORANGE = `<stop offset="0" stop-color="#ffc681"/><stop offset=".55" stop-color="#f28a3a"/><stop offset="1" stop-color="#c9601f"/>`;
export const ORANGE_STOPS: Array<[number, string]> = [[0, "#ffc681"], [0.55, "#f28a3a"], [1, "#c9601f"]];

const vb = `${LEFT} -${CAP} ${WIDTH} ${CAP}`;

/** The static wordmark: one path per letter, em units, one gradient across the cap height. */
export function wordmarkSvg(o: { id: string; attrs: string; title?: string }): string {
  const label = o.title ? `role="img" aria-labelledby="${o.id}-t"` : `aria-hidden="true" focusable="false"`;
  const title = o.title ? `<title id="${o.id}-t">${o.title}</title>` : "";
  const body = Object.values(letterPaths()).map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ${o.attrs} ${label}>${title}<defs><linearGradient id="${o.id}-g" x1="0" y1="-${CAP}" x2="0" y2="0" gradientUnits="userSpaceOnUse">${ORANGE}</linearGradient></defs><g fill="url(#${o.id}-g)" fill-rule="evenodd">${body}</g></svg>`;
}

/**
 * The hero intro: the wordmark (em units, placed on the sofa by the CSS transform with --wm-s) over the logo's
 * back and Screen (mark units). src/intro.ts morphs the U and the O and turns the C, C and H into dust; CSS does
 * the rest. The O is drawn under the U, so it glides in behind the U's arm.
 */
export function introSvg(): string {
  const l = letterPaths();
  const letter = (cls: string, i: number, d: string) => `<path class="l ${cls}" style="--i:${i}" d="${d}"/>`;
  return `<svg class="wm-intro" viewBox="0 0 ${MARK.w} ${MARK.h}" aria-hidden="true" focusable="false"><defs>`
    + `<linearGradient id="in-g" x1="0" y1="-${CAP}" x2="0" y2="0" gradientUnits="userSpaceOnUse">${ORANGE}</linearGradient>`
    + `<linearGradient id="in-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a372b"/><stop offset="1" stop-color="#2b1f18"/></linearGradient>`
    + `<linearGradient id="in-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d27536"/><stop offset="1" stop-color="#9c4d1d"/></linearGradient>`
    + `<radialGradient id="in-s" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#fff3e2"/><stop offset=".6" stop-color="#ffdcae"/><stop offset="1" stop-color="#f7b977"/></radialGradient>`
    + `<radialGradient id="in-h"><stop offset="0" stop-color="#ffd6a0" stop-opacity=".5"/><stop offset=".45" stop-color="#ff9646" stop-opacity=".2"/><stop offset="1" stop-color="#ff9646" stop-opacity="0"/></radialGradient></defs>`
    + `<ellipse class="i-halo" cx="416" cy="322" rx="330" ry="240" fill="url(#in-h)"/>`
    + `<path class="i-back" fill="url(#in-b)" d="${path(logo.back)}"/>`
    + `<path class="i-screen" fill="url(#in-s)" d="${path(logo.screen)}"/>`
    + `<g class="i-wm" fill="url(#in-g)" fill-rule="evenodd">`
    + letter("l-c1", 0, l.c1) + letter("l-c2", 3, l.c2) + letter("l-h", 4, l.h)
    + letter("l-o", 1, l.o) + `<path class="l-o l-o-frame" fill="url(#in-f)" d="${l.o}"/>`
    + letter("l-u", 2, l.u)
    + `</g></svg>`;
}

/** The widest the intro's wordmark gets (px), and its share of a narrow viewport. */
export const INTRO_MAX = 720, INTRO_VW = 0.88;

/**
 * Runs in <head> before the first paint: once per visit (sessionStorage), never with reduced motion or a
 * #section link, it marks the page for the intro and sizes the wordmark (--wm-s: mark units per em) so it
 * spans min(720px, 88vw) over a mark of min(320px, 62vw, 33vh), the hero mark's CSS size. In the "logo-only"
 * mode (src/config.ts) it also adds html.intro-logo, so the copy is never hidden.
 */
export const introHead = (mode: IntroMode) => `(function(){try{var d=document.documentElement,w=innerWidth,h=innerHeight;`
  + `if(location.hash.length>1||matchMedia("(prefers-reduced-motion: reduce)").matches||sessionStorage.getItem("couch:intro"))return;`
  + `sessionStorage.setItem("couch:intro","1");`
  + `d.style.setProperty("--wm-s",(Math.min(${INTRO_MAX},${INTRO_VW}*w)*${MARK.w}/Math.min(320,.62*w,.33*h)/${WIDTH}).toFixed(3));`
  + `d.classList.add(${mode === "logo-only" ? `"intro","intro-logo"` : `"intro"`})}catch(e){}})();`;
