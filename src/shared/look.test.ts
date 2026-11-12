import { describe, expect, it } from "vite-plus/test";
import { durationMs, GLASS, lookCss, lookTokens, type Look } from "./look.ts";

/** The output of the retired `glassTokensCss`, frozen here (less the aliases since removed: `--t1`–`--t3`, `--ease`, `--card-2`, `--r-tile`, `--r-row`, `--glass-edge`) so "no visual change" stays provable. */
const OLD = {
  colors: {
    glass: "rgba(44, 44, 48, 0.46)",
    "glass-strong": "rgba(36, 36, 40, 0.72)",
    "glass-solid": "rgba(30, 30, 34, 0.92)",
    card: "#2c2c2e",
    live: "#30d158",
    danger: "#ff453a",
  } as Record<string, string>,
  radii: {} as Record<string, number>,
};

function oldCss(unit: string, prefix = "", selector = ":root"): string {
  const lines = [
    ...Object.entries(OLD.colors).map(([n, v]) => `--${prefix}${n}: ${v};`),
    ...Object.entries(OLD.radii).map(([n, px]) => `--${prefix}${n}: calc(${px} * ${unit});`),
  ];
  return `${selector} { ${lines.join(" ")} }`;
}

function declarations(css: string): Map<string, string> {
  const body = /\{(.*)\}/s.exec(css)![1]!;
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]*);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

describe("lookCss", () => {
  const surfaces = [
    { name: "Screen", unit: "var(--u)", prefix: "" },
    { name: "phone", unit: "1px", prefix: "" },
    { name: "Web App controls", unit: "var(--couch-u)", prefix: "couch-" },
  ];

  for (const { name, unit, prefix } of surfaces) {
    it(`still writes every old token with an identical value (${name})`, () => {
      const next = declarations(lookCss(GLASS, { unit, prefix }));
      for (const [prop, value] of declarations(oldCss(unit, prefix))) {
        expect(next.get(prop), prop).toBe(value);
      }
    });
  }

  it("wraps the declarations in the selector, defaulting to :root", () => {
    expect(lookCss(GLASS, { unit: "1px" }).startsWith(":root { ")).toBe(true);
    expect(lookCss(GLASS, { unit: "1px", selector: "#x" }).startsWith("#x { ")).toBe(true);
  });

  it("scales lengths by the unit and leaves unitless numbers alone", () => {
    const d = declarations(lookCss(GLASS, { unit: "var(--u)" }));
    expect(d.get("--radius-tile")).toBe("calc(22 * var(--u))");
    expect(d.get("--type-caption")).toBe("calc(22 * var(--u))");
    expect(d.get("--row-height")).toBe("calc(96 * var(--u))");
    expect(d.get("--lib-cols")).toBe("4");
    expect(d.get("--focus-scale")).toBe("1.06");
    expect(d.get("--shadow-card")).toContain("calc(24 * var(--u))");
    expect(d.get("--shadow-card")).not.toContain("{u}");
  });

  it("writes every group's tokens, all prefixed", () => {
    const d = declarations(lookCss(GLASS, { unit: "1px", prefix: "x-" }));
    for (const prop of d.keys()) expect(prop.startsWith("--x-")).toBe(true);
    const joined = [...d.keys()].join(" ");
    for (const p of [
      "text-primary",
      "type-caption",
      "weight-bold",
      "radius-tile",
      "shadow-card",
      "blur-glass",
      "ease-glass",
      "duration-base",
      "focus-bg",
      "focus-scale-gear",
      "focus-shadow-pill",
      "line-height-body",
      "letter-spacing-display",
      "type-em-small",
      "row-height",
      "lib-cols",
      "design-width",
      "scrim-home",
    ]) {
      expect(joined).toContain(`--x-${p}`);
    }
  });

  it("writes the focus variants and type tokens with values in use today", () => {
    const d = declarations(lookCss(GLASS, { unit: "var(--u)" }));
    expect(d.get("--focus-scale-gear")).toBe("1.12");
    expect(d.get("--focus-shadow-pill")).toBe(
      "0 calc(20 * var(--u)) calc(40 * var(--u)) rgba(0, 0, 0, 0.4)",
    );
    expect(d.get("--line-height-clock-date")).toBe("calc(45 * var(--u))");
    expect(d.get("--letter-spacing-display")).toBe("-0.03em");
    expect(d.get("--type-em-small")).toBe("0.55em");
  });

  it("writes the role colours, the 40 px drawer blur, and the roles TypeScript reads", () => {
    const d = declarations(lookCss(GLASS, { unit: "var(--u)" }));
    expect(d.get("--press")).toBe("rgba(255, 255, 255, 0.14)");
    expect(d.get("--fill-bright")).toBe("#fff");
    expect(d.get("--track")).toBe("rgba(255, 255, 255, 0.2)");
    expect(d.get("--button-fill-soft")).toBe("rgba(255, 255, 255, 0.14)");
    expect(d.get("--blur-overlay")).toBe("blur(40px) saturate(1.8)");
    expect(d.get("--shadow-drawer")).toContain("calc(90 * var(--u))");
    expect(d.get("--type-title")).toBe("calc(44 * var(--u))");
    expect(d.get("--radius-dialog")).toBe("calc(48 * var(--u))");
    expect(d.get("--duration-drawer")).toBe("0.25s");
  });

  it("writes no unprefixed var() inside a value, so a prefixed surface resolves every token", () => {
    const css = lookCss(GLASS, { unit: "var(--couch-u)", prefix: "couch-" });
    const inside = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.filter((n) => n !== "--couch-u")).toEqual([]);
  });

  it("writes one declaration per token, with none empty", () => {
    const css = lookCss(GLASS, { unit: "1px" });
    const names = [...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    for (const v of declarations(css).values()) expect(v).not.toBe("");
  });
});

/** A token name that spells its value: a number, a hex or rgb colour, or a colour word. */
export function isByValueName(name: string): boolean {
  return /\d/.test(name) || /(^|-)(hex|rgb|rgba|hsl|white|black|px|ms)(-|$)/.test(name);
}

describe("token names", () => {
  it("name the job, never the value", () => {
    const byValue = lookTokens(GLASS, "1px", true)
      .map(([name]) => name)
      .filter(isByValueName);
    expect(byValue).toEqual([]);
  });

  it("the check catches names that spell a value", () => {
    for (const name of [
      "rgb-255-255-255-a014",
      "hex-1c1c1e",
      "blur-30px",
      "duration-ms380",
      "type-s22",
      "radius-r22",
      "line-height-140",
      "shadow-0-24px-70px-black35",
      "white",
      "black",
      "card2",
    ])
      expect(isByValueName(name), name).toBe(true);
    for (const name of ["text-primary", "radius-pill", "duration-drawer", "shadow-glass-edge"])
      expect(isByValueName(name), name).toBe(false);
  });
});

describe("GLASS", () => {
  it("satisfies Look", () => {
    const look: Look = GLASS;
    expect(Object.keys(look).sort()).toEqual(
      [
        "blur",
        "color",
        "focus",
        "gradient",
        "metrics",
        "motion",
        "radius",
        "shadow",
        "type",
      ].sort(),
    );
  });

  it("is a closed type: a Look missing a token does not compile", () => {
    const { textPrimary: _text, ...color } = GLASS.color;
    // @ts-expect-error `color.textPrimary` is required
    const noText: Look = { ...GLASS, color };
    const { pill: _pill, ...radius } = GLASS.radius;
    // @ts-expect-error `radius.pill` is required
    const noPill: Look = { ...GLASS, radius };
    const { caption: _caption, ...size } = GLASS.type.size;
    // @ts-expect-error `type.size.caption` is required
    const noCaption: Look = { ...GLASS, type: { ...GLASS.type, size } };
    expect(
      [noText.color, noPill.radius, noCaption.type.size].map((g) => Object.keys(g).length),
    ).toEqual([
      Object.keys(GLASS.color).length - 1,
      Object.keys(GLASS.radius).length - 1,
      Object.keys(GLASS.type.size).length - 1,
    ]);
  });

  it("gives durations in milliseconds for timers", () => {
    expect(durationMs("0.25s")).toBe(250);
    expect(durationMs("1s")).toBe(1000);
    expect(durationMs("90ms")).toBe(90);
    expect(() => durationMs("fast")).toThrow();
  });

  it("keeps the design base at 1920 × 1080", () => {
    expect(GLASS.metrics.base).toEqual({ width: 1920, height: 1080 });
  });
});
