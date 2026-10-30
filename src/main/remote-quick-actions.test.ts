import { afterEach, describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "./ports/store.ts";
import { parseCommand } from "./remote/server.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(async () => {
  await h?.stop();
});

const ids = (apps?: Array<{ id: string }>) => apps?.map((a) => a.id);

describe("Remote quick actions: the Apps row", () => {
  test("the snapshot lists the shown Apps in Home order, with label and icon, on Home", async () => {
    const store = new MemoryStore();
    store.write("home.apps", { order: ["library", "youtube", "netflix"], hidden: ["netflix"] });
    h = await startHarness(store);
    const phone = await h.connectPhone();
    expect(phone.last?.view).toBe("home");
    expect(ids(phone.last?.apps)).toEqual(["library", "youtube"]);
    expect(phone.last?.apps?.map((a) => a.label)).toEqual(["Library", "YouTube"]);
    expect(phone.last?.apps?.every((a) => a.icon.startsWith("<svg"))).toBe(true);
  });

  test("openApp opens a shown App, as OK on its tile would", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(phone.last?.view).toBe("app");
    expect(phone.last?.where).toBe("YouTube");
  });

  test("openApp opens the Library too", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "library" } });
    expect(phone.last?.view).toBe("library");
  });

  test("a hidden or unknown id is refused", async () => {
    const store = new MemoryStore();
    store.write("home.apps", { order: ["youtube", "netflix", "library"], hidden: ["netflix"] });
    h = await startHarness(store);
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "netflix" } });
    expect(phone.last?.view).toBe("home");
    await phone.press({ command: "openApp", args: { app: "nope" } });
    expect(phone.last?.view).toBe("home");
    await phone.press({ command: "openApp" });
    expect(phone.last?.view).toBe("home");
  });

  test("YouTube browse to Netflix: the row is there, and Netflix opens with YouTube hidden", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(ids(phone.last?.apps)).toContain("netflix");
    await phone.press({ command: "openApp", args: { app: "netflix" } });
    expect(phone.last?.where).toBe("Netflix");
    expect(h.youtube.calls.some((c) => c.call === "hide")).toBe(true);
    expect(h.netflix.calls.some((c) => c.call === "show")).toBe(true);
  });

  test("YouTube browse to Library", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    await phone.press({ command: "openApp", args: { app: "library" } });
    expect(phone.last?.view).toBe("library");
    expect(h.youtube.calls.some((c) => c.call === "hide")).toBe(true);
  });

  test("Settings to YouTube, with the row in Settings", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openSettings" });
    expect(phone.last?.view).not.toBe("home");
    expect(ids(phone.last?.apps)).toContain("youtube");
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(phone.last?.view).toBe("app");
    expect(phone.last?.where).toBe("YouTube");
  });

  test("opening the App that is in front does nothing", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    const hides = h.youtube.calls.filter((c) => c.call === "hide").length;
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(h.youtube.calls.filter((c) => c.call === "hide").length).toBe(hides);
    expect(phone.last?.where).toBe("YouTube");
  });

  test("it leaves Quick settings closed behind it", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "quickSettings" });
    expect(phone.last?.quickSettings).toBeTruthy();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(phone.last?.quickSettings).toBeFalsy();
    expect(phone.last?.where).toBe("YouTube");
  });

  test("a hidden App is refused from a browse page too", async () => {
    const store = new MemoryStore();
    store.write("home.apps", { order: ["youtube", "netflix", "library"], hidden: ["netflix"] });
    h = await startHarness(store);
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(ids(phone.last?.apps)).toEqual(["youtube", "library"]);
    await phone.press({ command: "openApp", args: { app: "netflix" } });
    expect(phone.last?.where).toBe("YouTube");
  });

  test("while something plays there is no row, and openApp is refused", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    h.youtube.emit({
      type: "playback",
      playback: { position: 5, duration: 600, paused: false, title: "A video" },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    expect(phone.last?.apps).toBeUndefined();
    await phone.press({ command: "openApp", args: { app: "library" } });
    expect(phone.last?.where).toBe("YouTube");
  });

  test("after 2 minutes of ambient mode, one tap clears it and opens the App", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    h.clock.advance(2 * 60_000);
    expect(h.app.screen().ambient).toBe(true);
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    expect(h.app.screen().ambient).toBe(false);
    expect(phone.last?.where).toBe("YouTube");
  });

  test("other commands still only wake ambient mode", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    h.clock.advance(2 * 60_000);
    await phone.press({ command: "openSettings" });
    expect(h.app.screen().ambient).toBe(false);
    expect(phone.last?.view).toBe("home");
  });

  test("a Remote's openApp takes only a short string id", () => {
    expect(parseCommand('{"type":"command","command":"openApp","args":{"app":"youtube"}}')).toEqual(
      {
        command: "openApp",
        args: { app: "youtube" },
      },
    );
    expect(parseCommand('{"type":"command","command":"openApp","args":{"app":5}}')).toBeUndefined();
    expect(parseCommand('{"type":"command","command":"openApp","args":{"x":"a"}}')).toBeUndefined();
  });
});
