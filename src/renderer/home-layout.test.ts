// @vitest-environment happy-dom
import { designUnit } from "../shared/design-unit.ts";
import { GLASS, homeClockHeight } from "../shared/look.ts";
import { describe, expect, test } from "vite-plus/test";
import { readCss } from "./testing/css-rules.ts";

const { clock, rows } = GLASS.metrics.home;
const CLOCK_BOTTOM = clock.top + homeClockHeight(GLASS);
// The caption under each tile (title, and a progress line on Continue tiles) is not in the Look: a generous allowance.
const CAPTION = 85;

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
    for (const [name, row] of Object.entries(rows)) {
      test(`${w}×${h} ${name}: the clock stays above the tile row`, () => {
        const u = designUnit(w, h);
        const rowTop = h - (row.bottom + row.tileHeight + CAPTION) * u;
        expect(CLOCK_BOTTOM * u).toBeLessThan(rowTop);
      });
    }
  }
});

describe("home.css draws the rows from the Look", () => {
  const { prop } = readCss("home.css");

  test.each([
    [".h-row", "bottom", "var(--home-row-bottom)"],
    [".h-app .g-tile", "height", "var(--home-tile-height)"],
    [".home.empty .h-row", "bottom", "var(--home-empty-row-bottom)"],
    [".home.empty .h-app .g-tile", "height", "var(--home-empty-tile-height)"],
  ])("%s %s is %s", (selector, name, value) => {
    expect(prop(selector, name)).toBe(value);
  });
});
