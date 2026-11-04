import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { REMOTE_PAGE } from "../main/remote/page.ts";
import { GLASS, lookCss } from "./look.ts";
import { quickSettingsPage } from "./quick-settings-page.ts";

/**
 * Keeps raw values out of the surfaces' CSS: colours, font sizes, radii, shadows and blurs come from the Look
 * as variables. A surface is switched on here once its rules have moved over.
 */

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g;

/** Literals that must stay, each with its reason. A value is the exact text of the declaration's value. */
const ALLOWED: { surface: string; property: string; value: string; reason: string }[] = [
  {
    surface: "phone",
    property: "border-radius",
    value: "50%",
    reason:
      "a circle (the D-pad, its buttons, the spinner), whatever the size; not a corner radius of the Look",
  },
];

function styleOf(html: string): string {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
}

const cssSurfaces: Record<string, string> = {
  phone: styleOf(REMOTE_PAGE),
  "quick settings": styleOf(quickSettingsPage({ glass: false })),
  "quick settings (glass)": styleOf(quickSettingsPage({ glass: true })),
};

const sourceSurfaces: Record<string, string> = {
  "web-hud.ts": readFileSync(new URL("../main/web/web-hud.ts", import.meta.url), "utf8"),
  "confirm-layout.ts": readFileSync(new URL("./confirm-layout.ts", import.meta.url), "utf8"),
};

/** The Look's own variables block (`:root { --x: …; }`) holds the raw values; only the rules after it are checked. */
const withoutTokens = (css: string) => css.replace(/:root\s*\{\s*--[^}]*\}/g, "");

function declarations(css: string): [string, string][] {
  return [...withoutTokens(css).matchAll(/([a-z-]+)\s*:\s*([^;{}]+?)\s*(?:;|(?=\}))/g)].map((m) => [
    m[1]!,
    m[2]!,
  ]);
}

const isAllowed = (surface: string, property: string, value: string) =>
  ALLOWED.some((a) => a.surface === surface && a.property === property && a.value === value);

const onlyVariables = (value: string) =>
  value
    .split(/\s+/)
    .every((part) => /^var\(--[\w-]+\)$/.test(part) || part === "0" || part === "none");

describe("the Look guard: CSS surfaces", () => {
  for (const [surface, css] of Object.entries(cssSurfaces)) {
    const decls = declarations(css);
    const body = withoutTokens(css);

    it(`${surface}: no raw colour literal`, () => {
      expect(body.match(COLOUR) ?? []).toEqual([]);
    });

    it(`${surface}: font-size, border-radius, box-shadow and backdrop-filter are variables`, () => {
      const bad = decls
        .filter(([p]) =>
          [
            "font-size",
            "border-radius",
            "box-shadow",
            "backdrop-filter",
            "-webkit-backdrop-filter",
          ].includes(p),
        )
        .filter(([p, v]) => !onlyVariables(v) && !isAllowed(surface, p, v))
        .map(([p, v]) => `${p}: ${v}`);
      expect(bad).toEqual([]);
    });
  }
});

describe("the Look guard: TypeScript style objects", () => {
  for (const [file, source] of Object.entries(sourceSurfaces)) {
    it(`${file}: no raw colour literal`, () => {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code.match(COLOUR) ?? []).toEqual([]);
    });

    it(`${file}: no numeric font size or corner radius`, () => {
      expect(source.match(/'?(font-size|border-radius)'?\s*:\s*px\(\s*\d/g) ?? []).toEqual([]);
      expect(source.match(/(fontSize|radius)\s*:\s*\d/g) ?? []).toEqual([]);
    });
  }
});

describe("every variable a surface uses is one the Look writes", () => {
  const written = new Set(
    [...lookCss(GLASS, { unit: "var(--u)" }).matchAll(/(--[\w-]+):/g)].map((m) => m[1]),
  );
  const local = new Set(["--u", "--couch-u"]);
  for (const [surface, css] of Object.entries(cssSurfaces)) {
    it(`${surface}: no misspelt token`, () => {
      const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
      expect([...used].filter((n) => !written.has(n) && !local.has(n))).toEqual([]);
    });
  }
});
