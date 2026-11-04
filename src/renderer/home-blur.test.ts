import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { GLASS } from "../shared/look.ts";

const css = readFileSync(new URL("./home.css", import.meta.url), "utf8");
/** Every rule written exactly for `selector`, joined. */
const rule = (selector: string) => {
  const blocks = [
    ...css.matchAll(new RegExp(`(?:^|\\n)${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`, "g")),
  ];
  expect(blocks.length, selector).toBeGreaterThan(0);
  return blocks.map((m) => m[1]).join("\n");
};
const unit = (expr: string) => {
  const sum = /calc\(\(?([\d\s+]+)\)?\s*\*\s*var\(--u\)\)/.exec(expr)?.[1];
  return sum!.split("+").reduce((a, n) => a + Number(n), 0);
};
const prop = (block: string, name: string) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? "";

describe("the blur behind the clock (1920 × 1080: 1 u = 1 px)", () => {
  const home = rule(".home");
  const top = unit(prop(home, "--clock-top"));
  const height = unit(prop(home, "--clock-h"));
  const pad = unit(prop(home, "--clock-pad"));

  test("the clock sits at the shared top and its box is the time, the gap and the date line", () => {
    expect(prop(rule(".h-clock"), "top")).toBe("var(--clock-top)");
    expect(prop(rule(".h-clock .t"), "font-size")).toBe("var(--type-s200)");
    expect(GLASS.type.size.s200).toBe(200);
    const date = rule(".h-clock .d");
    expect(prop(date, "line-height")).toBe("var(--line-height-s45)");
    expect(height).toBe(200 + unit(prop(date, "margin-top")) + GLASS.type.lineHeightSize.s45!);
    expect(top).toBe(210);
  });

  test("the top blur is fully opaque to below the date, then fades", () => {
    const blur = rule(".h-photo-blur.top");
    expect(prop(blur, "mask-image").replace(/\s+/g, "")).toBe(
      "linear-gradient(180deg,var(--black)0,var(--black)var(--clock-clear),transparent)",
    );
    expect(prop(home, "--clock-clear")).toBe(
      "calc(var(--clock-top) + var(--clock-h) + var(--clock-pad))",
    );
    expect(top + height + pad).toBeGreaterThanOrEqual(210 + 200 + 18 + 36);
    expect(prop(blur, "height")).toBe("calc(var(--clock-clear) + var(--clock-fade))");
  });
});
