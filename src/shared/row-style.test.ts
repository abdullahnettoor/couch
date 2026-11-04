import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { GLASS, lookCss } from "./look.ts";
import { ROW, rowCss } from "./row-style.ts";

const glass = readFileSync(new URL("../renderer/glass.css", import.meta.url), "utf8");
const block = /\.g-row\s*\{([^}]*)\}/.exec(glass)![1]!;

describe("the row look shared with Settings", () => {
  test("its sizes are the Look's, and the Screen's row reads them as variables", () => {
    expect(ROW).toBe(GLASS.metrics.row);
    const vars = lookCss(GLASS, { unit: "var(--u)" });
    expect(vars).toContain(`--row-height: calc(${ROW.height} * var(--u))`);
    expect(vars).toContain(`--row-font: calc(${ROW.font} * var(--u))`);
    expect(vars).toContain(`--row-gap: calc(${ROW.gap} * var(--u))`);
    expect(vars).toContain(`--row-pad-x: calc(${ROW.padX} * var(--u))`);
    expect(vars).toContain(`--row-value-font: calc(${ROW.valueFont} * var(--u))`);
    expect(block).toMatch(/height:\s*var\(--row-height\)/);
    expect(block).toMatch(/font-size:\s*var\(--row-font\)/);
    expect(block).toMatch(/margin-bottom:\s*var\(--row-gap\)/);
    expect(block).toMatch(/padding:\s*0 var\(--row-pad-x\)/);
    expect(glass).toMatch(/\.g-row \.v\s*\{[^}]*font-size:\s*var\(--row-value-font\)/);
  });

  test("renders the focus highlight and value style for a selector", () => {
    const css = rowCss(".row", "var(--u)");
    expect(css).toContain(".row.focus { background:var(--focus-bg); color:var(--focus-fg); }");
    expect(css).toContain(`height:calc(${ROW.height} * var(--u))`);
  });
});
