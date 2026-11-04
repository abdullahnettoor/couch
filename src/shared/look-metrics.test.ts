import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { designUnit } from "./design-unit.ts";
import { GLASS, lookCss, type Look } from "./look.ts";

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
    expect(glassCss).toMatch(/grid-template-columns:\s*repeat\(var\(--lib-cols\),/);
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
    for (const f of ["../renderer/views/library.ts", "../renderer/views/library-search.ts"])
      expect(src(f)).not.toMatch(/\b(60|96|120) \* /);
    expect(glassCss).toContain("var(--scroll-margin-edge)");
    expect(glassCss).toContain("var(--scroll-margin-block)");
  });
});

describe("Setup", () => {
  test("takes its easings and unit from the Look, not its own copies", () => {
    const s = src("../renderer/setup.ts");
    expect(s).not.toMatch(/cubic-bezier\(/);
    expect(s).not.toMatch(/\/ 1920/);
  });
});
