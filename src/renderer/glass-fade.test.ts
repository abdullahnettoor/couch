// @vitest-environment happy-dom
import { describe, expect, test } from "vite-plus/test";
import { GLASS, lookCss } from "../shared/look.ts";
import { readCss } from "./testing/css-rules.ts";

const glass = readCss("glass.css");

/** Chromium blurs a glass box only as far as its parent layer is opaque, so a panel's full-screen layer must never fade (#33). The headless proof is `pnpm glass:fade`. */
describe("a glass panel fades without turning its blur off", () => {
  test("the question's full-screen layer stays opaque; its scrim and box fade on their own", () => {
    expect(glass.prop(".confirm", "opacity")).toBe("");
    expect(glass.prop(".confirm.show", "opacity")).toBe("");
    expect(glass.prop(".confirm::before", "opacity")).toBe("0");
    expect(glass.prop(".confirm.show::before", "opacity")).toBe("1");
    expect(glass.prop(".confirm::before", "transition")).toContain("opacity");
    expect(glass.prop(".confirm .box", "opacity")).toBe("0");
    expect(glass.prop(".confirm .box.in", "opacity")).toBe("1");
    expect(glass.prop(".confirm .box", "transition")).toContain("opacity");
  });

  test("Setup's full-screen layer stays opaque; its box fades on its own", () => {
    expect(glass.prop("#setup.setup", "opacity")).toBe("");
    expect(glass.prop("#setup.setup.show", "opacity")).toBe("");
    expect(glass.prop(".setup .box", "transition")).toContain("opacity");
  });

  test("the Support Couch panel's layer stays opaque; its scrim and box fade on their own", () => {
    expect(glass.prop(".support-panel", "opacity")).toBe("");
    expect(glass.prop(".support-panel::before", "animation")).toContain("s-fade-in");
    expect(glass.prop(".support-box", "animation")).toContain("s-fade-in");
  });

  test("no full-screen layer holding a glass box fades", () => {
    const layers = glass.rules.filter(
      (r) => r.style.getPropertyValue("inset") === "0" && r.style.getPropertyValue("opacity"),
    );
    const fading = layers.flatMap((r) => r.selectorText.split(",").map((s) => s.trim()));
    for (const holder of [".confirm", ".confirm.show", "#setup.setup", "#setup.setup.show"])
      expect(fading).not.toContain(holder);
  });
});

describe("the Screen's glass over a WebKit App", () => {
  test("the question, Setup's panel, the toast and the volume display take the stronger tint", () => {
    for (const selector of [
      "body.native-app-front .toast",
      "body.native-app-front .volhud",
      "body.native-app-front .confirm .box",
      "body.native-app-front .setup .box",
    ])
      expect(glass.prop(selector, "background")).toBe("var(--glass-over-web-app)");
  });

  test("the tint is a Look token, stronger than the ordinary one, and written as a variable", () => {
    const alpha = (c: string) => Number(/,\s*([\d.]+)\)$/.exec(c)![1]);
    expect(alpha(GLASS.color.glassOverWebApp)).toBeGreaterThan(alpha(GLASS.color.glassStrong));
    expect(alpha(GLASS.color.glassOverWebApp)).toBeLessThan(alpha(GLASS.color.glassSolid));
    expect(lookCss(GLASS, { unit: "1px" })).toContain(
      `--glass-over-web-app: ${GLASS.color.glassOverWebApp};`,
    );
  });
});
