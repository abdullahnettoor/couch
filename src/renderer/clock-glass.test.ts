// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { GLASS, lookCss } from "../shared/look.ts";
import { readCss } from "./testing/css-rules.ts";

const home = readCss("home.css");
const all = readCss("home.css", "glass.css");
const alpha = (c: string) => Number(/,\s*([\d.]+)\)$/.exec(c)![1]);

/**
 * Home's clock is liquid glass (#37, version C of #35's prototype): nearly clear digits that bend the Wallpaper near
 * their edges, a thin rim lit from the top left, and a faint tint, lift and shadow so they read from a sofa.
 */
describe("the glass clock's Look", () => {
  const { color, blur } = GLASS;
  const map = GLASS.metrics.home.clockGlassMap;

  test("over a photo the tint is faint: about 5 % on the darkest picture to 21 % on the brightest", () => {
    expect(color.clockGlassTintDark).toBe("rgba(255, 255, 255, 0.05)");
    expect(color.clockGlassTintBright).toBe("rgba(255, 255, 255, 0.21)");
  });

  test("over the built-ins the tint is 10 %", () => {
    expect(color.clockGlassTintBuiltin).toBe("rgba(255, 255, 255, 0.1)");
  });

  test("the shadow outside the digits is light, and deepens with the picture's brightness", () => {
    expect(alpha(color.clockGlassShadowBright)).toBeGreaterThan(alpha(color.clockGlassShadowDark));
    for (const shadow of [
      color.clockGlassShadowDark,
      color.clockGlassShadowBright,
      color.clockGlassShadowBuiltin,
    ])
      expect(alpha(shadow)).toBeLessThanOrEqual(0.35);
  });

  test("inside the digits the picture is lifted a little: brighter and more saturated, not blurred", () => {
    expect(blur.clockGlassLift).toBe("brightness(1.12) saturate(1.2)");
  });

  test("the height map is built at half resolution, lit from the top left", () => {
    expect(map.scale).toBe(0.5);
    expect(map.light.x).toBeLessThan(0);
    expect(map.light.y).toBeLessThan(0);
    expect(Math.hypot(map.light.x, map.light.y)).toBeCloseTo(1, 1);
  });

  test("the rim is lit as feSpecularLighting does it, by a low light, so flat glass stays dark", () => {
    expect(map.light.elevation).toBeGreaterThan(0);
    expect(map.light.elevation).toBeLessThanOrEqual(15);
    expect(map.rimShine).toBeGreaterThanOrEqual(1);
    expect(map.rimShine).toBeLessThanOrEqual(128);
    expect(map.rimFill).toBeLessThan(map.rimStrength);
  });

  test("its colours, its lift and its lengths are written as variables", () => {
    const css = lookCss(GLASS, { unit: "var(--u)" });
    for (const name of [
      "--clock-glass-tint-dark",
      "--clock-glass-tint-bright",
      "--clock-glass-tint-builtin",
      "--clock-glass-shadow-dark",
      "--clock-glass-shadow-bright",
      "--clock-glass-shadow-builtin",
      "--blur-clock-glass-lift",
      "--home-clock-glass-pad",
    ])
      expect(css).toContain(`${name}: `);
  });

  test("#35's frosted digits stay, as the fallback without maps, under their own names", () => {
    expect(color.clockFrostTintDark).toBe("rgba(255, 255, 255, 0.14)");
    expect(color.clockFrostTintBright).toBe("rgba(255, 255, 255, 0.52)");
    expect(color.clockFrostTintBuiltin).toBe("rgba(255, 255, 255, 0.5)");
    expect(alpha(color.clockFrostShadowBright)).toBeGreaterThan(alpha(color.clockFrostShadowDark));
    expect(blur.clockFrost).toMatch(/^blur\(/);
    expect(blur.clockFrostBuiltin).toMatch(/^blur\(/);
    const css = lookCss(GLASS, { unit: "var(--u)" });
    for (const name of [
      "--clock-frost-tint-dark",
      "--clock-frost-tint-bright",
      "--clock-frost-tint-builtin",
      "--clock-frost-shadow-dark",
      "--clock-frost-shadow-bright",
      "--clock-frost-shadow-builtin",
      "--clock-frost-sheen",
      "--blur-clock-frost",
      "--blur-clock-frost-builtin",
    ])
      expect(css).toContain(`${name}: `);
    for (const name of ["--clock-glass-sheen", "--clock-glass-edge", "--blur-clock-glass:"])
      expect(css).not.toContain(name);
  });
});

describe("the glass clock's styles", () => {
  test("the lens bends the picture with the drawn filter, then lifts it, under the tint", () => {
    expect(home.prop(".h-clock .cg-lens", "backdrop-filter").replace(/,\s+\)/, ",)")).toBe(
      "var(--cg-refraction,) var(--blur-clock-glass-lift)",
    );
    expect(home.prop(".h-clock .cg-lens", "background-color")).toBe("var(--cg-tint)");
    expect(home.prop(".h-clock", "--cg-tint")).toBe("var(--clock-glass-tint-builtin)");
    expect(home.prop(".h-clock", "--cg-shadow")).toBe("var(--clock-glass-shadow-builtin)");
  });

  test("the rim is a still picture stretched over the glass's box", () => {
    expect(home.prop(".h-clock .cg-rim", "background-size")).toBe("100% 100%");
  });

  test("no frosted layer or top edge is left", () => {
    expect(() => home.rulesFor(".h-clock .cg-frost")).toThrow();
    expect(() => home.rulesFor(".h-clock .cg-edge")).toThrow();
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

  test("without maps the digits are frosted, as #35 drew them, and no rim is shown", () => {
    const flat = (s: string) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")");
    expect(home.prop(".h-clock.cg-frosted .cg-lens", "backdrop-filter")).toBe(
      "var(--cg-frost-blur)",
    );
    expect(home.prop(".h-clock.cg-frosted .cg-lens", "background-image")).toBe(
      "var(--clock-frost-sheen)",
    );
    expect(home.prop(".h-clock.cg-frosted .cg-rim", "display")).toBe("none");
    expect(home.prop(".h-clock.cg-frosted", "--cg-tint")).toBe("var(--clock-frost-tint-builtin)");
    expect(home.prop(".h-clock.cg-frosted", "--cg-shadow")).toBe(
      "var(--clock-frost-shadow-builtin)",
    );
    expect(home.prop(".h-clock.cg-frosted", "--cg-frost-blur")).toBe(
      "var(--blur-clock-frost-builtin)",
    );
    expect(home.prop(".home.photo .h-clock.cg-frosted", "--cg-frost-blur")).toBe(
      "var(--blur-clock-frost)",
    );
    expect(flat(home.prop(".home.photo .h-clock.cg-frosted", "--cg-tint"))).toBe(
      "color-mix(in srgb, var(--clock-frost-tint-bright) calc(var(--wp-light, 0.5) * 100%), var(--clock-frost-tint-dark))",
    );
    expect(flat(home.prop(".home.photo .h-clock.cg-frosted", "--cg-shadow"))).toBe(
      "color-mix(in srgb, var(--clock-frost-shadow-bright) calc(var(--wp-light, 0.5) * 100%), var(--clock-frost-shadow-dark))",
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
