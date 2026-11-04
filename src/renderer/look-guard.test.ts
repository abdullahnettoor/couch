import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { GLASS, lookCss } from "../shared/look.ts";

/** The Screen's CSS files: they take every colour, shadow, blur, easing and duration from the Look. */
const FILES = ["glass.css", "home.css", "player-overlay.css", "style.css"];

const read = (name: string) =>
  readFileSync(join(import.meta.dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Raw values that may stay, each with its reason. Entries are `file: exact text`.
 * (Empty today: the Screen's CSS has no exceptions.)
 */
export const ALLOWED: Record<string, string> = {};

/** Variables the Screen sets from the renderer's TypeScript or by the window (run-time values, not the Look's); the ones its CSS declares itself count too. */
const OWN = new Set([
  "u",
  "chrome-top",
  "hue",
  "amber",
  "amber-ink",
  "wp-base",
  "wp-glow",
  "wp-photo",
  "wp-dim",
  "wp-drift",
  "h",
  "dock-tint",
  "sx",
  "sy",
  "cols",
]);

export function rawValues(css: string): string[] {
  const found: string[] = [];
  const add = (re: RegExp) => found.push(...(css.match(re) ?? []));
  add(/#[0-9a-fA-F]{3,8}\b(?![-\w])/g);
  add(/rgba?\(\s*\d[^)]*\)/g);
  add(/hsla?\(\s*\d[^)]*\)/g);
  add(/cubic-bezier\([^)]*\)/g);
  add(/(?<![\w.-])\d*\.?\d+m?s\b(?![-\w])/g);
  for (const m of css.matchAll(
    /(?:^|[\s;{])((?:-webkit-)?backdrop-filter|box-shadow|text-shadow)\s*:\s*([^;}]+)/g,
  )) {
    for (const layer of m[2]!.split(/,(?![^(]*\))/).map((s) => s.trim())) {
      if (!/^(none|0|var\(--[\w-]+\))$/.test(layer)) found.push(`${m[1]}: ${layer}`);
    }
  }
  for (const m of css.matchAll(
    /(?:^|[\s;{])(font-size|font-weight|font-family|line-height|letter-spacing|border-radius)\s*:\s*([^;}]+)/g,
  )) {
    const value = m[2]!.trim();
    if (!/^(0|50%|inherit|(var\(--[\w-]+\)\s*)+)$/.test(value)) found.push(`${m[1]}: ${value}`);
  }
  return found;
}

describe("the Screen's CSS takes its look from the Look", () => {
  for (const file of FILES) {
    it(`${file} has no raw colour, shadow, blur, easing, duration, type or radius`, () => {
      const raw = rawValues(read(file)).filter((v) => !ALLOWED[`${file}: ${v}`]);
      expect(raw).toEqual([]);
    });
  }

  it("the guard catches a raw font size, weight, line height, letter spacing and radius", () => {
    expect(rawValues("a { font-size: calc(22 * var(--u)); }")).toEqual([
      "font-size: calc(22 * var(--u))",
    ]);
    expect(rawValues("a { border-radius: 12px; }")).toEqual(["border-radius: 12px"]);
    expect(rawValues("a { font-weight: 600; line-height: 1.4; letter-spacing: -0.02em; }")).toEqual(
      ["font-weight: 600", "line-height: 1.4", "letter-spacing: -0.02em"],
    );
    expect(
      rawValues(
        "a { font-size: var(--type-s22); border-radius: 50%; letter-spacing: 0; font: inherit; border-radius: var(--a) var(--b); }",
      ),
    ).toEqual([]);
  });

  it("the guard catches a raw colour, shadow and blur", () => {
    expect(rawValues("a { color: #abc; }")).toEqual(["#abc"]);
    expect(rawValues("a { background: rgba(0, 0, 0, 0.5); }")).toEqual(["rgba(0, 0, 0, 0.5)"]);
    expect(rawValues("a { box-shadow: 0 1px 2px var(--x); }")).toEqual([
      "box-shadow: 0 1px 2px var(--x)",
    ]);
    expect(rawValues("a { backdrop-filter: blur(4px); }")).toEqual(["backdrop-filter: blur(4px)"]);
    expect(rawValues("a { transition: opacity 0.3s; }")).toEqual(["0.3s"]);
    expect(
      rawValues("a { box-shadow: var(--shadow-glass-edge), none; color: var(--text-primary); }"),
    ).toEqual([]);
    expect(rawValues("#setup.setup { color: rgba(var(--warm), 0.3); }")).toEqual([]);
  });

  it("every var(--…) in the Screen's CSS is written by lookCss or set by the Screen itself", () => {
    const written = new Set(
      [...lookCss(GLASS, { unit: "var(--u)" }).matchAll(/--([\w-]+):/g)].map((m) => m[1]),
    );
    const files = readdirSync(import.meta.dirname).filter((f) => FILES.includes(f));
    expect(files.sort()).toEqual([...FILES].sort());
    const declared = new Set(
      FILES.flatMap((f) => [...read(f).matchAll(/(?:^|[\s;{])--([\w-]+)\s*:/g)].map((m) => m[1]!)),
    );
    for (const file of FILES) {
      const used = [...read(file).matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]!);
      const undefinedVars = used.filter((n) => !written.has(n) && !OWN.has(n) && !declared.has(n));
      expect(undefinedVars, file).toEqual([]);
    }
  });
});
