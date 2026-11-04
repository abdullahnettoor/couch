import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { lookSurfaces, rawIn, unknownVarsIn } from "./look-guard-scan.ts";

/**
 * Keeps raw values out of the phone page, the Quick settings drawer and a Web App's controls: colours,
 * type, radii, shadows, blurs, easing and durations come from the Look. The Screen's half is in
 * src/renderer/look-guard.test.ts; both use the scanner in look-guard-scan.ts.
 */
const others = lookSurfaces().filter((s) => s.surface !== "Screen");

describe("the Look guard: the phone, Quick settings and Web App controls", () => {
  it("covers all three surfaces", () => {
    expect([...new Set(others.map((s) => s.surface))]).toEqual([
      "phone",
      "Quick settings",
      "Web App controls",
    ]);
  });

  for (const source of others) {
    it(`${source.surface}, ${source.name}: no raw colour, type, radius, shadow, blur, easing or duration`, () => {
      expect(rawIn(source)).toEqual([]);
    });

    it(`${source.surface}, ${source.name}: every var(--…) is one the Look writes`, () => {
      expect(unknownVarsIn(source)).toEqual([]);
    });
  }

  it("the phone's inline styles are scanned too", () => {
    const phone = others.find((s) => s.surface === "phone")!;
    expect(phone.text).toContain("[style] { font-size:var(--type-phone-heading); }");
  });
});

describe("the design unit comes from the Look's base size", () => {
  for (const path of ["./quick-settings-page.ts", "./picture-off.ts", "../main/web/web-hud.ts"]) {
    it(`${path} writes no 1920 × 1080 of its own`, () => {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source.match(/\b(1920|1080)\b/g) ?? []).toEqual([]);
    });
  }
});
