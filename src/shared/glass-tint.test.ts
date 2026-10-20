import { expect, test } from "vite-plus/test";
import { darkTint } from "./glass-tint.ts";

test("darkens the colour and keeps it fairly opaque", () => {
  expect(darkTint([200, 100, 0])).toBe("rgba(56, 28, 0, 0.82)");
});

test("clamps out-of-range samples", () => {
  expect(darkTint([999, -5, 255])).toBe("rgba(71, 0, 71, 0.82)");
});
