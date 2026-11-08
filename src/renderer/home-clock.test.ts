// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { GLASS, homeClockHeight } from "../shared/look.ts";
import { readCss } from "./testing/css-rules.ts";

const { prop } = readCss("home.css");

describe("the blur behind the clock (1920 × 1080: 1 u = 1 px)", () => {
  const { clock } = GLASS.metrics.home;
  const height = homeClockHeight(GLASS);

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
    expect(clock.top).toBe(210);
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
    const dateTextBottom =
      clock.top + GLASS.type.size.clock + clock.dateGap + GLASS.type.size.clockDate;
    expect(clock.top + height + clock.pad).toBeGreaterThanOrEqual(dateTextBottom);
    expect(prop(".h-photo-blur.top", "height")).toBe(
      "calc(var(--clock-clear) + var(--clock-fade))",
    );
  });
});
