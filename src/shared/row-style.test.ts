import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { ROW, rowCss } from "./row-style.ts";

const glass = readFileSync(new URL("../renderer/glass.css", import.meta.url), "utf8");
const block = /\.g-row\s*\{([^}]*)\}/.exec(glass)![1]!;
const value = (prop: string) =>
  new RegExp(`${prop}:\\s*calc\\((\\d+) \\* var\\(--u\\)\\)`).exec(block)![1];

describe("the row look shared with Settings", () => {
  test("its sizes are Settings' own", () => {
    expect(Number(value("height"))).toBe(ROW.height);
    expect(Number(value("font-size"))).toBe(ROW.font);
    expect(Number(value("margin-bottom"))).toBe(ROW.gap);
    expect(/padding:\s*0 calc\((\d+) \* var\(--u\)\)/.exec(block)![1]).toBe(String(ROW.padX));
  });

  test("renders the focus highlight and value style for a selector", () => {
    const css = rowCss(".row", "var(--u)");
    expect(css).toContain(".row.focus { background:#fff; color:#000; }");
    expect(css).toContain(`height:calc(${ROW.height} * var(--u))`);
  });
});
