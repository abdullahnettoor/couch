import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const glass = read("./glass.css");
const home = read("./home.css");

/** Pixels in one design unit (`--u`) for a window, read from glass.css. */
const unitFor = (w: number, h: number) => {
  const expr = /--u:\s*([^;]+);/.exec(glass)![1]!;
  const sides = [...expr.matchAll(/100(vw|vh)\s*\/\s*(\d+)/g)].map(
    (m) => (m[1] === "vw" ? w : h) / Number(m[2]),
  );
  return expr.startsWith("min(") ? Math.min(...sides) : sides[0]!;
};

/** A property of the rule written exactly for `selector` in home.css, in design units. */
const units = (selector: string, name: string) => {
  const block = new RegExp(`(?:^|\\n)${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`).exec(
    home,
  )?.[1];
  const value = new RegExp(`(?:^|\\s)${name}:\\s*([^;]+);`).exec(block ?? "")?.[1];
  const sum = /calc\(\(?([\d\s+]+)\)?\s*\*\s*var\(--u\)\)/.exec(value ?? "")?.[1];
  expect(sum, `${selector} ${name}`).toBeDefined();
  return sum!.split("+").reduce((a, n) => a + Number(n), 0);
};

const CLOCK_BOTTOM = units(".home", "--clock-top") + units(".home", "--clock-h");
// The caption under each tile (title, and a progress line on Continue tiles) is not in home.css: a generous allowance.
const CAPTION = 85;
const LAYOUTS = {
  film: {
    bottom: units(".h-row", "bottom"),
    height: units(".h-app .g-tile", "height") + CAPTION,
  },
  empty: {
    bottom: units(".home.empty .h-row", "bottom"),
    height: units(".home.empty .h-app .g-tile", "height") + CAPTION,
  },
};

describe("Home layout on any Screen shape", () => {
  const sizes: [number, number][] = [
    [1920, 1080],
    [1440, 900],
    [1440, 1080],
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
