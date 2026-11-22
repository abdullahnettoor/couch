import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { APP_ENTRIES } from "./apps/index.ts";
import { BitChordApp } from "./apps/bitchord/bitchord-app.ts";
import { FakeClock, FakeYouTube } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
let phone: FakePhone;
let port: FakeYouTube;
const calls = (name: string) => port.calls.filter((c) => c.call === name);

beforeEach(async () => {
  port = new FakeYouTube();
  const entry = APP_ENTRIES.find((e) => e.id === "bitchord")!;
  h = await startHarness(undefined, {
    apps: [{ entry, app: new BitChordApp(port, new FakeClock()) }],
    beta: true,
  });
  phone = await h.connectPhone();
  for (let i = 0; i < 20 && h.screen.last.focusedId !== "bitchord"; i++) {
    const { grid, focusedId } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === "bitchord")!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  await phone.press("ok");
  port.calls.length = 0;
});
afterEach(() => h.stop());

describe("BitChord in front", () => {
  test("the phone gets Search BitChord", async () => {
    const s = await phone.press("up");
    expect(s.view).toBe("app");
    expect(s.where).toBe("BitChord");
    expect(s.typeAvailable).toBe(true);
    expect(s.typeLabel).toBe("Search BitChord");
  });

  test("⌘F opens its search bar on the Screen, and Enter searches BitChord", () => {
    port.emit({ type: "find" });
    expect(h.screen.last.state.typingBy).toBe("screen");
    expect(calls("captureText").at(-1)!.args).toEqual([true]);
    port.emit({ type: "edit", edit: { insert: "daft" } });
    expect(calls("showSearchBar").at(-1)!.args).toEqual(["daft"]);
    port.emit({ type: "edit", edit: { done: "submit" } });
    expect(calls("submitSearch").map((c) => c.args)).toEqual([["daft"]]);
  });

  test("Back on its home leaves only when the page has nothing open to close", async () => {
    port.overlays = 1;
    const s = await phone.press("back");
    expect(s.confirm).toBeUndefined();
    expect(port.overlays).toBe(0);
    await phone.press("back");
    await vi.waitFor(() => expect(h.screen.last.state.confirm?.title).toBe("Leave BitChord?"));
  });
});
