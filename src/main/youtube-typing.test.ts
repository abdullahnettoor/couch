import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
let a: FakePhone;
let b: FakePhone;
beforeEach(async () => {
  h = await startHarness();
  a = await h.connectPhone();
  b = await h.connectPhone();
  await a.press("ok");
  await b.settle();
});
afterEach(() => h.stop());

const calls = (name: string) => h.youtube.calls.filter((c) => c.call === name);

describe("YouTube typing", () => {
  test("typeOpen sets the owner, opens search; other phones see 'other'", async () => {
    await a.press("typeOpen");
    await b.settle();
    expect(a.last!.typing).toBe("you");
    expect(b.last!.typing).toBe("other");
    expect(h.screen.last.state.typingBy).toBeDefined();
  });

  test("nothing reaches YouTube until Search, which sends the owner's whole text once", async () => {
    await a.press("typeOpen");
    await a.press({ command: "typeText", args: { text: "kerala" } });
    await a.press({ command: "typeText", args: { text: "kerala fis" } });
    b.send({ command: "typeText", args: { text: "intruder" } });
    await b.settle();
    expect(calls("submitSearch")).toEqual([]);
    expect(h.screen.last.state.query).toBe("kerala fis");
    await a.press("typeSubmit");
    expect(calls("submitSearch").map((c) => c.args)).toEqual([["kerala fis"]]);
  });

  test("the bar over YouTube follows the typed text and closes on Search or Cancel", async () => {
    const bar = () => calls("showSearchBar").at(-1)!.args[0];
    await a.press("typeOpen");
    expect(bar()).toBe("");
    await a.press({ command: "typeText", args: { text: "kerala" } });
    expect(bar()).toBe("kerala");
    await a.press("typeCancel");
    expect(bar()).toBeUndefined();
    expect(calls("submitSearch")).toEqual([]);
    await a.press("typeOpen");
    await a.press({ command: "typeText", args: { text: "x" } });
    await a.press("typeSubmit");
    expect(bar()).toBeUndefined();
  });

  test("another phone cannot take over; its D-pad still works", async () => {
    await a.press("typeOpen");
    await b.press("typeOpen");
    expect(b.last!.typing).toBe("other");
    await b.press("down");
    expect(calls("sendKey").map((c) => c.args[0])).toContain("down");
  });

  test("Search submits and clears the owner", async () => {
    await a.press("typeOpen");
    await a.press({ command: "typeText", args: { text: "cats" } });
    const s = await a.press("typeSubmit");
    expect(s.typing).toBe("none");
    expect(calls("submitSearch")).toHaveLength(1);
  });

  test("Cancel clears the owner without submitting", async () => {
    await a.press("typeOpen");
    const s = await a.press("typeCancel");
    expect(s.typing).toBe("none");
    expect(calls("submitSearch")).toHaveLength(0);
  });

  test("owner disconnecting releases typing", async () => {
    await a.press("typeOpen");
    a.close();
    await b.waitFor(() => b.last!.typing === "none");
    const s = await b.press("typeOpen");
    expect(s.typing).toBe("you");
  });

  test("Type outside YouTube only toasts", async () => {
    await a.press("home");
    expect(a.last!.typeAvailable).toBe(false);
    await a.press("typeOpen");
    expect(a.last!.typing).toBe("none");
    expect(h.screen.last.state.toast).toBe("Typing works inside YouTube search or Netflix search");
  });

  test("YouTube's search screen opening replays nothing", async () => {
    await a.press("typeOpen");
    await a.press({ command: "typeText", args: { text: "kerala" } });
    h.youtube.emit({ type: "searchOpened" });
    await a.settle();
    expect(calls("submitSearch")).toEqual([]);
  });

  test("search route auto-opens the sheet on the last commander", async () => {
    await b.press("ok");
    h.youtube.emit({ type: "searchOpened" });
    await b.waitFor(() => b.last!.typing === "you");
    await a.waitFor(() => a.last!.typing === "other");
  });
});
