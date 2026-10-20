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
    expect(calls("openSearch")).toHaveLength(1);
    expect(h.app.core.screen().state.typingBy).toBeDefined();
  });

  test("typeText reaches the port with the whole text, only from the owner", async () => {
    await a.press("typeOpen");
    await a.press({ command: "typeText", args: { text: "kerala" } });
    await a.press({ command: "typeText", args: { text: "kerala fis" } });
    b.send({ command: "typeText", args: { text: "intruder" } });
    await b.settle();
    expect(calls("setSearchText").map((c) => c.args[0])).toEqual(["kerala", "kerala fis"]);
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
    expect(h.app.core.screen().state.toast).toBe("Typing works inside YouTube search");
    expect(calls("openSearch")).toHaveLength(0);
  });

  test("text typed before the search screen is ready is replayed when it opens", async () => {
    await a.press("typeOpen");
    await a.press({ command: "typeText", args: { text: "kerala" } });
    const before = calls("setSearchText").length;
    h.youtube.emit({ type: "searchOpened" });
    await a.settle();
    expect(calls("setSearchText").length).toBe(before + 1);
    expect(calls("setSearchText").at(-1)!.args[0]).toBe("kerala");
  });

  test("search route auto-opens the sheet on the last commander", async () => {
    await b.press("ok");
    h.youtube.emit({ type: "searchOpened" });
    await b.waitFor(() => b.last!.typing === "you");
    await a.waitFor(() => a.last!.typing === "other");
    expect(calls("openSearch")).toHaveLength(0);
  });
});
