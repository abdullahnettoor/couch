import { describe, expect, test } from "vite-plus/test";
import { FakeClock, FakeYouTube } from "../../ports/fakes.ts";
import { BitChordApp } from "./bitchord-app.ts";

describe("BitChord's typing", () => {
  test("it offers Search BitChord, and a search, its bar and text capture reach the host", () => {
    const port = new FakeYouTube();
    const app = new BitChordApp(port, new FakeClock());
    expect(app.typing?.label).toBe("Search BitChord");
    app.typing!.submitSearch("coldplay");
    app.typing!.showSearchBar("cold");
    app.typing!.captureText(true);
    expect(port.calls.map((c) => [c.call, ...c.args])).toEqual([
      ["submitSearch", "coldplay"],
      ["showSearchBar", "cold"],
      ["captureText", true],
    ]);
  });
});
