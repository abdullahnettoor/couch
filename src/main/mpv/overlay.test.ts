import { expect, test } from "vite-plus/test";
import { formatTime, overlayAss } from "./overlay.ts";

test("formats times", () => {
  expect(formatTime(65)).toBe("1:05");
  expect(formatTime(3725)).toBe("1:02:05");
});

test("overlay shows title, times, pause icon and volume only when asked", () => {
  const full = overlayAss({
    title: "Dune",
    bar: { position: 60, duration: 600 },
    paused: true,
    volume: 40,
  });
  expect(full).toContain("Dune");
  expect(full).toContain("1:00");
  expect(full).toContain("-9:00");
  expect(full).toContain("Volume 40%");
  expect(overlayAss({ title: "Dune", paused: false })).toBe("");
});
