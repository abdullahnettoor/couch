import { readFileSync } from "node:fs";
import { designUnit } from "../shared/design-unit.ts";
import { describe, expect, test } from "vite-plus/test";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const home = read("./home.css");

/** Pixels in one design unit (`--u`) for a window: the Look's own. */
const unitFor = designUnit;

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
