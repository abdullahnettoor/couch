import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
let phone: FakePhone;
beforeEach(async () => {
  h = await startHarness();
  phone = await h.connectPhone();
});
afterEach(() => h.stop());

const calls = (name: string) => h.youtube.calls.filter((c) => c.call === name);
const keys = () => calls("sendKey").map((c) => c.args[0]);
const quits = () => h.mac.calls.filter((c) => c.call === "quit");
const lastConfirm = () =>
  calls("showConfirm").at(-1)?.args[0] as
    | { title: string; buttons: string[]; focus: number }
    | undefined;

async function openYouTube() {
  await phone.press("ok");
}
const route = (home: boolean) => h.youtube.emit({ type: "route", home });

describe("Back inside YouTube", () => {
  test("Back on a Short or a watch page goes back inside YouTube", async () => {
    await openYouTube();
    route(false);
    expect((await phone.press("back")).view).toBe("youtube");
    expect(keys()).toEqual(["back"]);
    expect(calls("hide")).toHaveLength(0);
    expect(h.screen.last.state.confirm).toBeUndefined();
  });

  test("Back at YouTube's home asks Leave YouTube? and does not leave", async () => {
    await openYouTube();
    route(true);
    const s = await phone.press("back");
    expect(s.view).toBe("youtube");
    expect(s.confirm).toEqual({
      title: "Leave YouTube?",
      buttons: ["Stay", "Go to Home"],
      focus: 0,
    });
    expect(h.screen.last.state.confirm?.title).toBe("Leave YouTube?");
    expect(lastConfirm()?.title).toBe("Leave YouTube?");
    expect(keys()).toEqual([]);
  });

  test("Stay, or a second Back, keeps YouTube", async () => {
    await openYouTube();
    route(true);
    await phone.press("back");
    let s = await phone.press("ok");
    expect(s.view).toBe("youtube");
    expect(s.confirm).toBeUndefined();
    expect(lastConfirm()).toBeUndefined();
    await phone.press("back");
    s = await phone.press("back");
    expect(s.view).toBe("youtube");
    expect(s.confirm).toBeUndefined();
  });

  test("Go to Home goes home", async () => {
    await openYouTube();
    route(true);
    await phone.press("back");
    await phone.press("right");
    expect(h.screen.last.state.confirm?.focus).toBe(1);
    const s = await phone.press("ok");
    expect(s.view).toBe("home");
    expect(s.confirm).toBeUndefined();
    expect(calls("hide")).toHaveLength(1);
  });

  test("the phone's Home goes straight home, even with the question up", async () => {
    await openYouTube();
    route(true);
    expect((await phone.press("home")).view).toBe("home");
    await openYouTube();
    await phone.press("back");
    const s = await phone.press("home");
    expect(s.view).toBe("home");
    expect(s.confirm).toBeUndefined();
    expect(lastConfirm()).toBeUndefined();
  });

  test("the D-pad doesn't reach YouTube while the question is up", async () => {
    await openYouTube();
    route(true);
    await phone.press("back");
    await phone.press("down");
    await phone.press("left");
    expect(keys()).toEqual([]);
  });

  test("a Back that changes nothing counts as being at home", async () => {
    await openYouTube();
    route(false);
    await phone.press("back");
    h.clock.advance(1500);
    const s = await phone.press("back");
    expect(keys()).toEqual(["back"]);
    expect(s.confirm?.title).toBe("Leave YouTube?");
  });

  test("a Back that is followed by a new route is not stuck", async () => {
    await openYouTube();
    route(false);
    await phone.press("back");
    route(false);
    h.clock.advance(1500);
    const s = await phone.press("back");
    expect(keys()).toEqual(["back", "back"]);
    expect(s.confirm).toBeUndefined();
  });

  test("Backs pressed in quick succession all reach YouTube", async () => {
    await openYouTube();
    route(false);
    await phone.press("back");
    await phone.press("back");
    expect(keys()).toEqual(["back", "back"]);
  });
});

describe("Quit Couch?", () => {
  async function openSettings() {
    await phone.press("up");
    await phone.press("ok");
  }

  test("⌘Q asks first; Cancel (focused) keeps Couch", async () => {
    expect(h.app.requestQuit()).toBe(false);
    expect(h.screen.last.state.confirm).toEqual({
      title: "Quit Couch?",
      buttons: ["Cancel", "Quit"],
      focus: 0,
    });
    await phone.waitFor(() => phone.last?.confirm?.title === "Quit Couch?");
    await phone.press("ok");
    expect(quits()).toHaveLength(0);
    expect(h.screen.last.state.confirm).toBeUndefined();
  });

  test("Back dismisses it", async () => {
    h.app.requestQuit();
    const s = await phone.press("back");
    expect(s.confirm).toBeUndefined();
    expect(quits()).toHaveLength(0);
  });

  test("Quit quits, and the app then lets ⌘Q through", async () => {
    h.app.requestQuit();
    await phone.press("right");
    await phone.press("ok");
    expect(quits()).toHaveLength(1);
    expect(h.app.requestQuit()).toBe(true);
  });

  test("Settings → Quit asks first", async () => {
    await openSettings();
    for (let i = 0; i < 12 && h.screen.last.focusedLabel !== "Quit Couch"; i++)
      await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.confirm?.title).toBe("Quit Couch?");
    expect(quits()).toHaveLength(0);
    await phone.press("right");
    await phone.press("ok");
    expect(quits()).toHaveLength(1);
  });

  test("over YouTube the YouTube port draws it", async () => {
    await openYouTube();
    h.app.requestQuit();
    expect(lastConfirm()?.title).toBe("Quit Couch?");
    await phone.press("back");
    expect(lastConfirm()).toBeUndefined();
  });

  test("phone Power and a system quit never ask", async () => {
    await phone.press("power");
    expect(quits()).toHaveLength(1);
    expect(h.screen.last.state.confirm).toBeUndefined();
  });

  test("a system quit (log out, shut down) is let through", () => {
    h.app.approveQuit();
    expect(h.app.requestQuit()).toBe(true);
  });
});
