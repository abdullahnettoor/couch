import { describe, expect, test } from "vite-plus/test";
import { keyCommand } from "./picture-off-keys.ts";

const off = { command: "setPictureOff", args: { on: false } };

describe("Mac keys while the picture is off", () => {
  test("Space and the media play/pause key play and pause", () => {
    expect(keyCommand({ key: " " }, true, false)).toEqual({ command: "playpause" });
    expect(keyCommand({ key: "MediaPlayPause" }, true, false)).toEqual({ command: "playpause" });
  });

  test.each(["Tab", "Backspace", "F1", "Shift", "q"])(
    "%s only turns the picture back on",
    (key) => {
      expect(keyCommand({ key }, true, false)).toEqual(off);
    },
  );

  test("a modified key only turns the picture back on", () => {
    expect(keyCommand({ key: " ", meta: true }, true, false)).toEqual(off);
  });

  test("with the picture on, keys are mapped as before and unmapped ones do nothing", () => {
    expect(keyCommand({ key: "Tab" }, false, false)).toBeUndefined();
    expect(keyCommand({ key: "ArrowUp" }, false, false)).toEqual({ command: "up" });
  });
});
