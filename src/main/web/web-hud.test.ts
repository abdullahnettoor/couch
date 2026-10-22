import { describe, expect, test } from "vite-plus/test";
import { confirmScript } from "./web-hud.ts";

describe("the page's confirmation", () => {
  test("its buttons take the mouse: hover focuses, click answers", () => {
    const script = confirmScript({ title: "Q", buttons: ["Cancel", "Quit"], focus: 0 });
    expect(script).toContain("couch:confirm-hover:");
    expect(script).toContain("couch:confirm:");
    expect(script).toContain("'pointer-events':'auto'");
  });
});
