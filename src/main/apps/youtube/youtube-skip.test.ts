import { expect, test } from "vite-plus/test";
import { skipKeys } from "./youtube-skip.ts";

test("a skip with the controls hidden wakes them first", () => {
  expect(skipKeys(10, false)).toEqual(["right", "right"]);
  expect(skipKeys(-10, false)).toEqual(["left", "left"]);
});

test("a skip with the controls up scrubs straight away", () => {
  expect(skipKeys(10, true)).toEqual(["right"]);
  expect(skipKeys(-30, true)).toEqual(["left", "left", "left"]);
});
