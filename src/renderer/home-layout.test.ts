// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { designUnit } from "../shared/design-unit.ts";
import { GLASS } from "../shared/look.ts";
import { describe, expect, test } from "vite-plus/test";

const home = GLASS.metrics.home;
const CLOCK_BOTTOM =
  home.clockTop + GLASS.type.size.clock + home.clockDateGap + GLASS.type.lineHeightSize.clockDate;
// The caption under each tile (title, and a progress line on Continue tiles) is not in the Look: a generous allowance.
const CAPTION = 85;
const LAYOUTS = {
  film: { bottom: home.rowBottom, height: home.tileHeight + CAPTION },
  empty: { bottom: home.emptyRowBottom, height: home.emptyTileHeight + CAPTION },
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
        const u = designUnit(w, h);
        const rowTop = h - (row.bottom + row.height) * u;
        expect(CLOCK_BOTTOM * u).toBeLessThan(rowTop);
      });
    }
  }
});

describe("home.css draws the rows from the Look", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(import.meta.dirname, "home.css"), "utf8");
  document.head.append(style);
  const rule = (selector: string) =>
    Array.from(style.sheet!.cssRules).find(
      (r) => (r as CSSStyleRule).selectorText === selector,
    ) as CSSStyleRule;

  test.each([
    [".h-row", "bottom", "var(--home-row-bottom)"],
    [".h-app .g-tile", "height", "var(--home-tile-height)"],
    [".home.empty .h-row", "bottom", "var(--home-empty-row-bottom)"],
    [".home.empty .h-app .g-tile", "height", "var(--home-empty-tile-height)"],
  ])("%s %s is %s", (selector, prop, value) => {
    expect(rule(selector).style.getPropertyValue(prop)).toBe(value);
  });
});
