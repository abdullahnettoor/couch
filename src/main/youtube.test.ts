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
const awake = () => h.mac.calls.filter((c) => c.call === "keepDisplayAwake").map((c) => c.args[0]);

async function openYouTube() {
  await phone.press("ok");
}

describe("YouTube App", () => {
  test("OK on the tile shows YouTube with the Home note and keeps the display awake", async () => {
    const s = await phone.press("ok");
    expect(s.view).toBe("youtube");
    expect(s.where).toBe("YouTube");
    expect(calls("show")).toHaveLength(1);
    expect(calls("show")[0].args[0]).toBe("Press Home on your phone to come back");
    expect(awake()).toEqual([true]);
  });

  test("arrows, OK and Back are forwarded; Home is not", async () => {
    await openYouTube();
    for (const c of ["up", "down", "left", "right", "ok"] as const) await phone.press(c);
    h.youtube.emit({ type: "route", topLevel: false });
    await phone.press("back");
    await phone.press("playpause");
    expect(calls("sendKey").map((c) => c.args[0])).toEqual([
      "up",
      "down",
      "left",
      "right",
      "ok",
      "back",
    ]);
    expect(calls("playPause")).toHaveLength(1);
    await phone.press("home");
    expect(calls("sendKey")).toHaveLength(6);
  });

  test("keys pressed inside YouTube go through the core, once each", async () => {
    await openYouTube();
    h.youtube.emit({ type: "key", command: "down" });
    expect(calls("sendKey").map((c) => c.args[0])).toEqual(["down"]);
    h.youtube.emit({ type: "route", topLevel: false });
    h.youtube.emit({ type: "key", command: "back" });
    expect(calls("sendKey").map((c) => c.args[0])).toEqual(["down", "back"]);
    h.youtube.emit({ type: "key", command: "home" });
    await phone.waitFor(() => phone.last?.view === "home");
    expect(calls("hide")).toHaveLength(1);
  });

  test("keyboard Back at YouTube's top level goes Home", async () => {
    await openYouTube();
    h.youtube.emit({ type: "key", command: "back" });
    await phone.waitFor(() => phone.last?.view === "home");
  });

  test("the volume level is shown over YouTube and cleared after 3 s", async () => {
    await openYouTube();
    const levels = () => calls("showVolume").map((c) => c.args[0]);
    await phone.press("volUp");
    expect(levels().at(-1)).toBe(55);
    h.clock.advance(3100);
    expect(levels().at(-1)).toBeUndefined();
  });

  test("Home hides and pauses, goes Home, lets the display sleep; reopening shows it again", async () => {
    await openYouTube();
    const s = await phone.press("home");
    expect(s.view).toBe("home");
    expect(calls("hide")).toHaveLength(1);
    h.clock.advance(30 * 60_000);
    expect(awake()).toEqual([true, false]);
    await phone.press("ok");
    expect(calls("show")).toHaveLength(2);
    expect(calls("restart")).toHaveLength(0);
  });

  test("Back at YouTube's top level goes Home; deeper Back is forwarded", async () => {
    await openYouTube();
    h.youtube.emit({ type: "route", topLevel: false });
    expect((await phone.press("back")).view).toBe("youtube");
    expect(calls("sendKey").at(-1)?.args[0]).toBe("back");
    h.youtube.emit({ type: "route", topLevel: true });
    const s = await phone.press("back");
    expect(s.view).toBe("home");
    expect(calls("hide")).toHaveLength(1);
  });

  test("a load failure shows Couch's own screen; OK retries", async () => {
    await openYouTube();
    h.youtube.emit({ type: "failed" });
    await phone.waitFor(() => phone.last?.view === "youtubeError");
    expect(h.screen.last.state.view).toBe("youtubeError");
    expect(h.screen.last.focusedLabel).toBe("Try again");
    expect(calls("hide")).toHaveLength(1);
    const s = await phone.press("ok");
    expect(s.view).toBe("youtube");
    expect(calls("restart")).toHaveLength(1);
    expect(calls("show")).toHaveLength(2);
  });

  test("opening YouTube after a failure shows the error screen; Back goes Home", async () => {
    h.youtube.emit({ type: "failed" });
    const s = await phone.press("ok");
    expect(s.view).toBe("youtubeError");
    expect(calls("show")).toHaveLength(0);
    expect((await phone.press("back")).view).toBe("home");
  });

  test("Restart YouTube in Settings restarts the view", async () => {
    await phone.press("up");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settings");
    for (let i = 0; i < 3; i++) await phone.press("down");
    expect(h.screen.last.focusedLabel).toBe("Restart YouTube");
    await phone.press("ok");
    expect(calls("restart")).toHaveLength(1);
    expect(h.screen.last.state.view).toBe("settings");
    expect(h.screen.last.state.toast).toBe("Restarting YouTube");
  });

  test("the Remote shows volume in YouTube only, and volume changes the Mac volume", async () => {
    expect(phone.last?.showVolume).toBe(false);
    await openYouTube();
    expect(phone.last?.showVolume).toBe(true);
    h.mac.volume = 50;
    await phone.press("volUp");
    await phone.waitFor(() => h.mac.volume === 55);
    await phone.press("volDown");
    await phone.press("volDown");
    await phone.waitFor(() => h.mac.volume === 45);
    await phone.press("home");
    expect(phone.last?.showVolume).toBe(false);
  });
});
