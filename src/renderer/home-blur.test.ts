// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { GLASS } from "../shared/look.ts";

const style = document.createElement("style");
style.textContent = readFileSync(join(import.meta.dirname, "home.css"), "utf8");
document.head.append(style);
/** A property as the last rule written exactly for `selector` in home.css that sets it has it. */
const prop = (selector: string, name: string) => {
  const rules = Array.from(style.sheet!.cssRules).filter(
    (r) => (r as CSSStyleRule).selectorText === selector,
  ) as CSSStyleRule[];
  expect(rules.length, selector).toBeGreaterThan(0);
  const values = rules.map((r) => r.style.getPropertyValue(name).trim()).filter(Boolean);
  return values.at(-1) ?? "";
};

describe("the blur behind the clock (1920 × 1080: 1 u = 1 px)", () => {
  const home = GLASS.metrics.home;
  const height = GLASS.type.size.clock + home.clockDateGap + GLASS.type.lineHeightSize.clockDate;

  test("the clock sits at the shared top and its box is the time, the gap and the date line", () => {
    expect(prop(".home", "--clock-top")).toBe("var(--home-clock-top)");
    expect(prop(".h-clock", "top")).toBe("var(--clock-top)");
    expect(prop(".h-clock .t", "font-size")).toBe("var(--type-clock)");
    expect(prop(".h-clock .d", "margin-top")).toBe("var(--home-clock-date-gap)");
    expect(prop(".h-clock .d", "line-height")).toBe("var(--line-height-clock-date)");
    expect(prop(".home", "--clock-h")).toBe(
      "calc(var(--type-clock) + var(--home-clock-date-gap) + var(--line-height-clock-date))",
    );
    expect(GLASS.type.size.clock).toBe(200);
    expect(home.clockTop).toBe(210);
  });

  test("the top blur is fully opaque to below the date, then fades", () => {
    expect(prop(".h-photo-blur.top", "mask-image").replace(/\s+/g, "")).toBe(
      "linear-gradient(180deg,var(--mask-opaque)0,var(--mask-opaque)var(--clock-clear),transparent)",
    );
    expect(prop(".home", "--clock-pad")).toBe("var(--home-clock-pad)");
    expect(prop(".home", "--clock-fade")).toBe("var(--home-clock-fade)");
    expect(prop(".home", "--clock-clear")).toBe(
      "calc(var(--clock-top) + var(--clock-h) + var(--clock-pad))",
    );
    expect(home.clockTop + height + home.clockPad).toBeGreaterThanOrEqual(210 + 200 + 18 + 36);
    expect(prop(".h-photo-blur.top", "height")).toBe(
      "calc(var(--clock-clear) + var(--clock-fade))",
    );
  });
});
