import { expect, test } from "vite-plus/test";
import { keyBelongsToField } from "./field-keys.ts";

test.each(["h", "m", " ", "/", "Enter", "ArrowLeft", "ArrowDown", "Backspace", "H"])(
  "%j goes to a focused field",
  (key) => expect(keyBelongsToField({ key, meta: false })).toBe(true),
);

test("Esc stays Couch's Back and ⌘F stays Find", () => {
  expect(keyBelongsToField({ key: "Escape", meta: false })).toBe(false);
  expect(keyBelongsToField({ key: "f", meta: true })).toBe(false);
  expect(keyBelongsToField({ key: "v", meta: true })).toBe(true);
});
