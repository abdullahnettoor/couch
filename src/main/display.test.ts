import { expect, test } from "vite-plus/test";
import { pickTargetDisplay } from "./display.ts";

const builtIn = { id: 1, label: "Built-in Retina Display", internal: true };
const tv = { id: 2, label: "LG TV", internal: false };

test("picks the external monitor when connected", () => {
  expect(pickTargetDisplay([builtIn, tv])).toBe(tv);
});

test("picks the built-in screen when alone", () => {
  expect(pickTargetDisplay([builtIn])).toBe(builtIn);
});

test("returns undefined with no displays", () => {
  expect(pickTargetDisplay([])).toBeUndefined();
});
