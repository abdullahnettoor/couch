import { readdirSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  ALLOWED,
  lookSurfaces,
  rawIn,
  rawInCss,
  rawInScript,
  SCREEN_CSS,
  unknownVarsIn,
} from "../shared/look-guard-scan.ts";

/** The Screen's styles take every colour, type size, radius, shadow, blur, easing and duration from the Look. */
const screen = lookSurfaces().filter((s) => s.surface === "Screen");

describe("the Screen's styles take their look from the Look", () => {
  it("covers every stylesheet in src/renderer", () => {
    const css = readdirSync(import.meta.dirname).filter((f) => f.endsWith(".css"));
    expect(css.sort()).toEqual([...SCREEN_CSS].sort());
    expect(screen.map((s) => s.name)).toEqual([...SCREEN_CSS, "picture-off.ts"]);
  });

  for (const source of screen) {
    it(`${source.name} has no raw colour, type, radius, shadow, blur, easing or duration`, () => {
      expect(rawIn(source)).toEqual([]);
    });

    it(`every var(--…) in ${source.name} is written by the Look or set by the Screen itself`, () => {
      expect(unknownVarsIn(source)).toEqual([]);
    });
  }
});

describe("the guard's scanner", () => {
  it("catches a raw font size, weight, line height, letter spacing and radius", () => {
    expect(rawInCss("a { font-size: calc(22 * var(--u)); }")).toEqual([
      "font-size: calc(22 * var(--u))",
    ]);
    expect(rawInCss("a { border-radius: 12px; }")).toEqual(["border-radius: 12px"]);
    expect(rawInCss("a { font-weight: 600; line-height: 1.4; letter-spacing: -0.02em; }")).toEqual([
      "font-weight: 600",
      "line-height: 1.4",
      "letter-spacing: -0.02em",
    ]);
    expect(rawInCss("a { font: 600 22px/1 sans-serif; }")).toEqual(["font: 600 22px/1 sans-serif"]);
    expect(
      rawInCss(
        "a { font-size: var(--type-caption); border-radius: 50%; letter-spacing: 0; font: inherit; border-radius: var(--a) var(--b); }",
      ),
    ).toEqual(["border-radius: 50%"]);
  });

  it("catches a raw colour, shadow, blur, easing and duration", () => {
    expect(rawInCss("a { color: #abc; }")).toEqual(["#abc"]);
    expect(rawInCss("a { background: rgba(0, 0, 0, 0.5); }")).toEqual(["rgba(0, 0, 0, 0.5)"]);
    expect(rawInCss("a { color: rgba(var(--warm), 0.3); }")).toEqual(["rgba(var(--warm), 0.3)"]);
    expect(rawInCss("a { box-shadow: 0 1px 2px var(--x); }")).toEqual([
      "box-shadow: 0 1px 2px var(--x)",
    ]);
    expect(rawInCss("a { text-shadow: 0 1px 2px var(--x); }")).toEqual([
      "text-shadow: 0 1px 2px var(--x)",
    ]);
    expect(rawInCss("a { backdrop-filter: blur(4px); }")).toEqual(["backdrop-filter: blur(4px)"]);
    expect(rawInCss("a { filter: drop-shadow(0 0 4px var(--x)); }")).toEqual([
      "filter: drop-shadow(0 0 4px var(--x))",
    ]);
    expect(rawInCss("a { filter: brightness(1.8); }")).toEqual([]);
    expect(rawInCss("a { transition: opacity 0.3s; }")).toEqual(["0.3s"]);
    expect(rawInCss("a { animation: spin var(--d) linear infinite; }")).toEqual([
      "animation: linear",
    ]);
    expect(rawInCss("a { animation: blink var(--d) steps(2, start); }")).toEqual([
      "steps(2, start)",
    ]);
    expect(rawInCss("a { transition: opacity var(--d) cubic-bezier(0, 0, 1, 1); }")).toEqual([
      "cubic-bezier(0, 0, 1, 1)",
    ]);
    expect(
      rawInCss(
        "a { box-shadow: var(--shadow-glass-edge), none; color: var(--text-primary); transition: opacity var(--duration-quick) var(--ease-glass); }",
      ),
    ).toEqual([]);
  });

  it("skips the Look's own variables block and comments", () => {
    expect(
      rawInCss(":root { --x: #fff; --y: 0.3s; } /* #abc 2s */ a { color: var(--x); }"),
    ).toEqual([]);
  });

  it("catches raw values in TypeScript that writes styles", () => {
    expect(rawInScript("css(d,{'border-radius':px(40),'font-size':px(${T.size})})")).toEqual([
      "border-radius: px(40)",
    ]);
    expect(rawInScript(`{ "font-weight": "600", color: b.color }`)).toEqual(['font-weight: "600"']);
    expect(rawInScript("font:'600 '+px(22)+'/1 sans-serif'")).toEqual([
      "font: '600 '+px(22)+'/1 sans-serif'",
    ]);
    expect(rawInScript("{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'}")).toEqual([
      "cubic-bezier(.2,.8,.2,1)",
      "duration: 220",
      "easing: 'cubic-bezier(.2",
    ]);
    expect(rawInScript("{ fontSize: 30, radius: GLASS.radius.dialog }")).toEqual(["fontSize: 30"]);
    expect(rawInScript("{ background: '#fff' }")).toEqual(["#fff", "background: '#fff'"]);
    expect(rawInScript("{duration:${ms(d.dropIn)},easing:${JSON.stringify(e.standard)}}")).toEqual(
      [],
    );
  });

  it("documents every allowlist entry, and each one is still in use", () => {
    for (const a of ALLOWED) expect(a.reason.length, a.text).toBeGreaterThan(20);
    expect(new Set(ALLOWED.map((a) => `${a.surface}: ${a.text}`)).size).toBe(ALLOWED.length);
    const all = lookSurfaces().flatMap((s) =>
      (s.kind === "css" ? rawInCss(s.text) : rawInScript(s.text)).map((text) => ({
        surface: s.surface,
        text,
      })),
    );
    for (const a of ALLOWED) {
      expect(
        all.some((r) => r.text === a.text && (a.surface === "*" || a.surface === r.surface)),
        a.text,
      ).toBe(true);
    }
  });
});
