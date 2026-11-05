// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { readCss } from "../renderer/testing/css-rules.ts";
import { GLASS, lookCss } from "./look.ts";
import { ROW, rowCss } from "./row-style.ts";

const glass = readCss("glass.css");

describe("the row look shared with Settings", () => {
  test("its sizes are the Look's, and the Screen's row reads them as variables", () => {
    expect(ROW).toBe(GLASS.metrics.row);
    const vars = lookCss(GLASS, { unit: "var(--u)" });
    expect(vars).toContain(`--row-height: calc(${ROW.height} * var(--u))`);
    expect(vars).toContain(`--row-font: calc(${ROW.font} * var(--u))`);
    expect(vars).toContain(`--row-gap: calc(${ROW.gap} * var(--u))`);
    expect(vars).toContain(`--row-pad-x: calc(${ROW.padX} * var(--u))`);
    expect(vars).toContain(`--row-value-font: calc(${ROW.valueFont} * var(--u))`);
    expect(glass.prop(".g-row", "height")).toBe("var(--row-height)");
    expect(glass.prop(".g-row", "font-size")).toBe("var(--row-font)");
    expect(glass.prop(".g-row", "margin-bottom")).toBe("var(--row-gap)");
    expect(glass.prop(".g-row", "padding")).toBe("0px var(--row-pad-x)");
    expect(glass.prop(".g-row .v", "font-size")).toBe("var(--row-value-font)");
  });

  test("renders the focus highlight and value style for a selector", () => {
    const css = rowCss(".row", "var(--u)");
    expect(css).toContain(".row.focus { background:var(--focus-bg); color:var(--focus-fg); }");
    expect(css).toContain(`height:calc(${ROW.height} * var(--u))`);
  });
});
