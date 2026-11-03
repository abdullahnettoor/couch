import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const glass = readFileSync(new URL("./glass.css", import.meta.url), "utf8");

/** Pixels in one design unit (`--u`) for a window, read from glass.css. */
const unitFor = (w: number, h: number) => {
  const expr = /--u:\s*([^;]+);/.exec(glass)![1]!;
  const sides = [...expr.matchAll(/100(vw|vh)\s*\/\s*(\d+)/g)].map(
    (m) => (((m[1] === "vw" ? w : h) / 100) * 100) / Number(m[2]),
  );
  return expr.startsWith("min(") ? Math.min(...sides) : sides[0]!;
};

// Design units, from home.css: the clock box (top + height), and each layout's tile row.
const CLOCK_BOTTOM = 210 + 263;
const LAYOUTS = {
  film: { bottom: 84, height: 255 },
  empty: { bottom: 120, height: 236 + 85 },
};

describe("Home layout on any Screen shape", () => {
  const sizes: [number, number][] = [
    [1920, 1080],
    [1440, 900],
    [2560, 1080],
    [3440, 1440],
    [5120, 1440],
  ];
  for (const [w, h] of sizes) {
    for (const [name, row] of Object.entries(LAYOUTS)) {
      test(`${w}×${h} ${name}: the clock stays above the tile row`, () => {
        const u = unitFor(w, h);
        const rowTop = h - (row.bottom + row.height) * u;
        expect(CLOCK_BOTTOM * u).toBeLessThan(rowTop);
      });
    }
  }
});
