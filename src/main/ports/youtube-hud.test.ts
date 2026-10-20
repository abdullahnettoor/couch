import { describe, expect, test } from "vite-plus/test";
import { noteScript, volumeScript } from "./youtube-hud.ts";

describe("youtube hud scripts", () => {
  test("volume shows the clamped level", () => {
    expect(volumeScript(42.4)).toContain("height:42%");
    expect(volumeScript(250)).toContain("height:100%");
  });
  test("no level removes the indicator", () => {
    expect(volumeScript(undefined)).toContain("remove()");
  });
  test("note text is escaped into the script", () => {
    expect(noteScript('He said "hi"')).toContain(JSON.stringify('He said "hi"'));
  });
});
