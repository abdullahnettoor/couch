import { expect, test } from "vite-plus/test";
import { findMpv } from "./find-mpv.ts";

test("prefers the Homebrew path over PATH", () => {
  const found = findMpv({ PATH: "/usr/bin:/elsewhere" }, () => true);
  expect(found).toBe("/opt/homebrew/bin/mpv");
});

test("falls back to PATH", () => {
  const found = findMpv({ PATH: "/usr/bin:/elsewhere" }, (p) => p === "/elsewhere/mpv");
  expect(found).toBe("/elsewhere/mpv");
});

test("returns undefined when mpv is nowhere", () => {
  expect(findMpv({ PATH: "/usr/bin" }, () => false)).toBeUndefined();
});
