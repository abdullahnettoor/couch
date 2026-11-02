import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CAP, LEFT, WIDTH, introHead, letters, logo, mix, path, toEm, type Poly } from "./wordmark.ts";

const xs = (polys: Poly[]) => polys.flat().map(([x]) => x);
const ys = (polys: Poly[]) => polys.flat().map(([, y]) => y);

test("the morphing letters have the logo's corners, one for one", () => {
  assert.equal(letters.u.length, 1);
  assert.equal(letters.u[0].length, logo.sofa.length);
  assert.equal(letters.o.length, logo.frame.length);
  letters.o.forEach((p, i) => assert.equal(p.length, logo.frame[i].length));
});

test("the wordmark spans WIDTH, sits on the baseline and is centred on the U", () => {
  const all = Object.values(letters).flat();
  assert.equal(Math.min(...xs(all)), LEFT);
  assert.equal(Math.max(...xs(all)), LEFT + WIDTH);
  assert.equal(Math.min(...ys(all)), -CAP);
  assert.equal(Math.max(...ys(all)), 0);
  assert.equal(Math.min(...xs(letters.u)) + Math.max(...xs(letters.u)), 0);
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
