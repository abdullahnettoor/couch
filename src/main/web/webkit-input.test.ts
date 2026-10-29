import { describe, expect, test } from "vite-plus/test";
import { couchOverlayOpen } from "./webkit-input.ts";

describe("couchOverlayOpen", () => {
  test("nothing over the page: the page keeps the mouse", () => {
    expect(couchOverlayOpen({ pictureOff: false }, false)).toBe(false);
  });
  test("a toast or the volume level only draws, so it is not an overlay", () => {
    expect(couchOverlayOpen({ pictureOff: false }, false)).toBe(false);
  });
  test.each([
    ["Quick settings", { pictureOff: false }, true],
    ["a confirmation", { pictureOff: false, confirm: { title: "t" } }, false],
    ["Picture off", { pictureOff: true }, false],
  ])("%s is one", (_name, state, quick) => {
    expect(couchOverlayOpen(state, quick)).toBe(true);
  });
});
