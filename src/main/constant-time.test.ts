import { expect, test } from "vite-plus/test";
import { safeEqual } from "./constant-time.ts";

test("safeEqual matches equal strings only, whatever their lengths", () => {
  expect(safeEqual("abc", "abc")).toBe(true);
  expect(safeEqual("abc", "abd")).toBe(false);
  expect(safeEqual("abc", "abcd")).toBe(false);
  expect(safeEqual("", "")).toBe(true);
  expect(safeEqual("", "a")).toBe(false);
});
