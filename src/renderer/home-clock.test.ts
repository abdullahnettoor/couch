// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { GLASS } from "../shared/look.ts";
import { readCss } from "./testing/css-rules.ts";

const { prop } = readCss("home.css");

describe("the clock's box (1920 × 1080: 1 u = 1 px)", () => {
  test("the clock sits at the shared top and its box is the time, the gap and the date line", () => {
    expect(prop(".home", "--clock-top")).toBe("var(--home-clock-top)");
    expect(prop(".h-clock", "top")).toBe("var(--clock-top)");
    expect(prop(".h-clock .t", "font-size")).toBe("var(--type-clock)");
    expect(prop(".h-clock .d", "margin-top")).toBe("var(--home-clock-date-gap)");
    expect(prop(".h-clock .d", "line-height")).toBe("var(--line-height-clock-date)");
    expect(GLASS.type.size.clock).toBe(200);
    expect(GLASS.metrics.home.clock.top).toBe(210);
  });
});
