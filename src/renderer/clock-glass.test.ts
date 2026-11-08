// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { GLASS, lookCss } from "../shared/look.ts";
import { readCss } from "./testing/css-rules.ts";

const home = readCss("home.css");
const all = readCss("home.css", "glass.css");
const alpha = (c: string) => Number(/,\s*([\d.]+)\)$/.exec(c)![1]);

/** Home's clock is glass (#35): the digits are cut out of a frosted layer over the Wallpaper. */
describe("the glass clock's Look", () => {
  const { color, blur } = GLASS;

  test("over a photo the tint runs from the dark-picture tint to a whiter one for bright pictures", () => {
    expect(alpha(color.clockGlassTintBright)).toBeGreaterThan(alpha(color.clockGlassTintDark));
    expect(color.clockGlassTintDark).toMatch(/^rgba\(255, 255, 255, /);
    expect(color.clockGlassTintBright).toMatch(/^rgba\(255, 255, 255, /);
  });

  test("over the dark built-ins the tint is brighter than over a dark photo, so the glass doesn't vanish", () => {
    expect(alpha(color.clockGlassTintBuiltin)).toBeGreaterThan(alpha(color.clockGlassTintDark));
    expect(blur.clockGlassBuiltin).toMatch(/^blur\(/);
    expect(blur.clockGlass).toMatch(/^blur\(/);
  });

  test("the shadow deepens with the picture's brightness", () => {
    expect(alpha(color.clockGlassShadowBright)).toBeGreaterThan(alpha(color.clockGlassShadowDark));
  });

  test("its tokens are written as variables", () => {
    const css = lookCss(GLASS, { unit: "var(--u)" });
    for (const name of [
      "--clock-glass-tint-dark",
      "--clock-glass-tint-bright",
      "--clock-glass-tint-builtin",
      "--clock-glass-shadow-dark",
      "--clock-glass-shadow-bright",
      "--clock-glass-shadow-builtin",
      "--clock-glass-sheen",
      "--clock-glass-edge",
      "--blur-clock-glass",
      "--blur-clock-glass-builtin",
      "--home-clock-glass-pad",
    ])
      expect(css).toContain(`${name}: `);
  });
});

describe("the glass clock's styles", () => {
  test("the frosted layer blurs with the photo's filter, or the built-ins' brighter one", () => {
    expect(home.prop(".h-clock .cg-frost", "backdrop-filter")).toBe("var(--cg-blur)");
    expect(home.prop(".h-clock", "--cg-blur")).toBe("var(--blur-clock-glass-builtin)");
    expect(home.prop(".home.photo .h-clock", "--cg-blur")).toBe("var(--blur-clock-glass)");
    expect(home.prop(".h-clock", "--cg-tint")).toBe("var(--clock-glass-tint-builtin)");
    expect(home.prop(".h-clock", "--cg-shadow")).toBe("var(--clock-glass-shadow-builtin)");
  });

  test("over a photo the tint and the shadow follow its brightness", () => {
    const flat = (s: string) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")");
    expect(flat(home.prop(".home.photo .h-clock", "--cg-tint"))).toBe(
      "color-mix(in srgb, var(--clock-glass-tint-bright) calc(var(--wp-light, 0.5) * 100%), var(--clock-glass-tint-dark))",
    );
    expect(flat(home.prop(".home.photo .h-clock", "--cg-shadow"))).toBe(
      "color-mix(in srgb, var(--clock-glass-shadow-bright) calc(var(--wp-light, 0.5) * 100%), var(--clock-glass-shadow-dark))",
    );
  });

  test("the digits' own text is see-through once the glass is drawn", () => {
    expect(home.prop(".h-clock .t.cg-drawn", "color")).toBe("transparent");
    expect(home.prop(".h-clock .t.cg-drawn small", "color")).toBe("transparent");
  });

  test("no blur band sits behind the clock; the one behind the tiles stays", () => {
    expect(() => home.rulesFor(".h-photo-blur.top")).toThrow();
    expect(home.prop(".h-photo-blur.bottom", "bottom")).toBe("0px");
  });
});

/** A see-through parent turns a child's blur off (#33), so the clock never fades as a whole. The headless proof is `pnpm glass:fade`. */
describe("the glass clock fades without turning its glass off", () => {
  test("the clock's own layer has no opacity; its parts fade on their own", () => {
    for (const selector of [".h-clock", ".h-clock.on", ".home.ambient .h-clock"])
      expect(
        all.rules
          .filter((r) =>
            r.selectorText
              .split(",")
              .map((s) => s.trim())
              .includes(selector),
          )
          .map((r) => r.style.getPropertyValue("opacity"))
          .filter(Boolean),
        selector,
      ).toEqual([]);
    for (const part of [".h-clock .t", ".h-clock .d", ".h-clock .cg"]) {
      expect(home.prop(part, "opacity"), part).toBe("0");
      expect(home.prop(part, "transition"), part).toContain("opacity");
      expect(home.prop(part.replace(".h-clock", ".h-clock.on"), "opacity"), part).toBe("1");
    }
  });

  test("Setup's farewell raises the clock and fades its parts, never the clock itself", () => {
    const rise = all.prop(".setup-farewell .home .h-clock", "animation");
    expect(rise).toContain("s-clock-rise");
    const frames = Array.from(all.keyframes("s-clock-rise").cssRules) as CSSKeyframeRule[];
    for (const f of frames) expect(f.style.getPropertyValue("opacity")).toBe("");
    expect(all.prop(".setup-farewell .home .h-clock > *", "animation")).toContain("s-fade");
  });
});
