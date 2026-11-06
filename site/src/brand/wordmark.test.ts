import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CAP, LEFT, WIDTH, introHead, letters } from "./wordmark.ts";
import { logo, mix, path, toEm, type Poly } from "./logo.ts";

const xs = (polys: Poly[]) => polys.flat().map(([x]) => x);
/** Every coordinate pair in an outline path. */
const pts = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

test("the morphing letters have the logo's corners, one for one", () => {
  assert.equal(letters.u.length, 1);
  assert.equal(letters.u[0].length, logo.sofa.length);
  assert.equal(letters.o.length, logo.frame.length);
  letters.o.forEach((p, i) => assert.equal(p.length, logo.frame[i].length));
});

test("the U and O keep their shapes: sharp arm tops, round base, a slot for the Screen", () => {
  const [u] = letters.u;
  // arm tops (outer, inner, inner, outer) are square; the base is round
  for (const i of [0, 1, 4, 5]) assert.equal(u[i][2], 0);
  for (const i of [6, 7]) assert.ok(u[i][2] > 20);
  // the U sits on the baseline at cap height, its counter open at the top
  assert.equal(Math.min(...u.map((c) => c[1])), -CAP);
  assert.equal(Math.max(...u.map((c) => c[1])), 0);
  // the O's slot is wider than tall, like the Screen
  const [, slot] = letters.o, w = Math.max(...xs([slot])) - Math.min(...xs([slot]));
  const h = Math.max(...slot.map((c) => c[1])) - Math.min(...slot.map((c) => c[1]));
  assert.ok(w / h > 1.6 && w / h < 2.4, `slot ${w} × ${h}`);
});

test("the wordmark spans LEFT … LEFT + WIDTH, sits on the baseline and is centred on the U", () => {
  const all = [...pts(letters.c1), ...pts(letters.c2), ...pts(letters.h), ...letters.o.flat(), ...letters.u.flat()];
  assert.ok(Math.abs(Math.min(...all.map(([x]) => x)) - LEFT) < 0.01);
  assert.ok(Math.abs(Math.max(...all.map(([x]) => x)) - (LEFT + WIDTH)) < 0.01);
  assert.equal(Math.min(...all.map(([, y]) => y)), -CAP);
  assert.equal(Math.max(...all.map(([, y]) => y)), 0);
  assert.ok(Math.abs(Math.min(...xs(letters.u)) + Math.max(...xs(letters.u))) < 0.5);
});

test("the sofa lands on the U: same baseline and centre at any scale", () => {
  for (const s of [1.5, 2.65, 4]) {
    const sofa = toEm(logo.sofa, s);
    assert.ok(Math.abs(Math.max(...sofa.map(([, y]) => y))) < 1e-9);
    const x = sofa.map(([v]) => v);
    assert.ok(Math.abs(Math.min(...x) + Math.max(...x)) < 1);
  }
});

test("a morph starts and ends on its shapes, and every frame is a closed path of corner arcs", () => {
  const a = letters.u[0], b = toEm(logo.sofa, 2.4);
  assert.deepEqual(mix(a, b, 0), a);
  assert.deepEqual(mix(a, b, 1).map((c) => c.map((v) => Math.round(v * 1e6) / 1e6)), b.map((c) => c.map((v) => Math.round(v * 1e6) / 1e6)));
  for (const t of [0, 0.3, 0.7, 1]) {
    const d = path(mix(a, b, t));
    assert.match(d, /^M[^MZ]+Z$/);
    assert.equal(d.match(/C/g)!.length, a.length);
    assert.doesNotMatch(d, /NaN/);
  }
});

test("no font file other than the Geist web fonts is in the repository", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" }).split("\n");
  const fonts = files.filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
  assert.deepEqual(fonts.filter((f) => !/^src\/fonts\/Geist(Mono)?-Variable\.woff2$/.test(f)), [], "only the Geist web fonts are committed");
});

test("the <head> script sizes the mark exactly as the CSS does, in both intro modes", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.mark \{ --lamp: min\(320px, 62vw, 33vh\);/);
  for (const mode of ["sequence", "logo-only"] as const) {
    const head = introHead(mode);
    assert.match(head, /Math\.min\(320,\.62\*w,\.33\*h\)/);
    assert.match(head, /sessionStorage/);
    assert.match(head, /prefers-reduced-motion: reduce/);
  }
  assert.doesNotMatch(introHead("sequence"), /intro-logo/);
  assert.match(introHead("logo-only"), /"intro","intro-logo"/);
});
