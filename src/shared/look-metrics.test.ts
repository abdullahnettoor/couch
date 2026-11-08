import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { designUnit } from "./design-unit.ts";
import { GLASS, homeClockHeight, lookCss, type Look } from "./look.ts";

const glassCss = readFileSync(new URL("../renderer/glass.css", import.meta.url), "utf8");
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("the design unit", () => {
  test("designUnit and --u both come from metrics.base", () => {
    const { width, height } = GLASS.metrics.base;
    expect(designUnit(width, height)).toBe(1);
    expect(designUnit(width / 2, height * 2)).toBe(0.5);
    expect(lookCss(GLASS, { unit: "var(--u)", defineUnit: true })).toContain(
      `--u: min(100vw / ${width}, 100vh / ${height});`,
    );
    const wide: Look = {
      ...GLASS,
      metrics: { ...GLASS.metrics, base: { width: 960, height: 540 } },
    };
    expect(lookCss(wide, { unit: "var(--u)", defineUnit: true })).toContain(
      "--u: min(100vw / 960, 100vh / 540);",
    );
  });

  test("only the Screen defines --u; glass.css no longer does", () => {
    expect(lookCss(GLASS, { unit: "1px" })).not.toMatch(/--u:/);
    // The text, not the parsed rules: --u must not appear anywhere in glass.css, in a rule, a comment or a value.
    expect(glassCss).not.toMatch(/--u:/);
  });
});

describe("the Library's numbers", () => {
  test("the tile columns reach the drawn grid as a variable, and the core imports them", () => {
    const more: Look = {
      ...GLASS,
      metrics: { ...GLASS.metrics, library: { ...GLASS.metrics.library, tileColumns: 6 } },
    };
    expect(lookCss(more, { unit: "var(--u)" })).toContain("--lib-cols: 6;");
    // Rule existence only (no number read): the grid's columns are drawn from the variable wherever the rule sits.
    expect(glassCss).toMatch(/grid-template-columns:\s*repeat\(var\(--lib-cols\),/);
    // Source text: the core's constant is a TypeScript import, which no stylesheet or render shows.
    expect(src("../main/core/pages/library-page.ts")).toContain(
      "export const TILE_COLUMNS = GLASS.metrics.library.tileColumns;",
    );
  });

  test("the scroll margins are the Look's in TypeScript and in CSS", () => {
    const m = GLASS.metrics.library;
    const css = lookCss(GLASS, { unit: "var(--u)" });
    expect(css).toContain(`--scroll-margin-block: calc(${m.scrollMarginBlock} * var(--u));`);
    expect(css).toContain(`--scroll-margin-edge: calc(${m.scrollMarginEdge} * var(--u));`);
    expect(css).toContain(`--scroll-margin-search: calc(${m.scrollMarginSearch} * var(--u));`);
    // Source text: the views must not keep their own copies of the margins, which only their source can show.
    for (const f of ["../renderer/views/library.ts", "../renderer/views/library-search.ts"])
      expect(src(f)).not.toMatch(/\b(60|96|120) \* /);
    // Rule existence only: the margins are used somewhere in glass.css, whichever rules use them.
    expect(glassCss).toContain("var(--scroll-margin-edge)");
    expect(glassCss).toContain("var(--scroll-margin-block)");
  });
});

describe("Home's numbers", () => {
  test("the clock's box and the tile rows are the Look's, written as lengths", () => {
    const d = lookCss(GLASS, { unit: "var(--u)" });
    for (const decl of [
      "--home-clock-top: calc(210 * var(--u));",
      "--home-clock-date-gap: calc(18 * var(--u));",
      "--home-clock-glass-pad: calc(60 * var(--u));",
      "--home-row-bottom: calc(84 * var(--u));",
      "--home-tile-height: calc(170 * var(--u));",
      "--home-empty-row-bottom: calc(120 * var(--u));",
      "--home-empty-tile-height: calc(236 * var(--u));",
      "--home-pan-scale: 1.06;",
    ])
      expect(d).toContain(decl);
  });

  test("a Look with other Home numbers writes those", () => {
    const moved: Look = {
      ...GLASS,
      metrics: {
        ...GLASS.metrics,
        home: {
          clock: { ...GLASS.metrics.home.clock, top: 180 },
          clockGlass: GLASS.metrics.home.clockGlass,
          rows: { ...GLASS.metrics.home.rows, empty: { bottom: 100, tileHeight: 200 } },
          panScale: 1.1,
        },
      },
    };
    const d = lookCss(moved, { unit: "1px" });
    expect(d).toContain("--home-clock-top: calc(180 * 1px);");
    expect(d).toContain("--home-empty-row-bottom: calc(100 * 1px);");
    expect(d).toContain("--home-empty-tile-height: calc(200 * 1px);");
    expect(d).toContain("--home-pan-scale: 1.1;");
  });

  test("the clock's box is the time, the gap under it and the date line", () => {
    expect(homeClockHeight(GLASS)).toBe(200 + 18 + 45);
  });
});

describe("Setup", () => {
  test("takes its easings and unit from the Look, not its own copies", () => {
    // Source text: a copied easing or unit in setup.ts would only show in its source.
    const s = src("../renderer/setup.ts");
    expect(s).not.toMatch(/cubic-bezier\(/);
    expect(s).not.toMatch(/\/ 1920/);
  });
});
