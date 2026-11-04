import { afterEach, describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h?.stop());

const fresh = async (store = new MemoryStore()) => {
  h = await startHarness(store, { setup: "fresh" });
  return store;
};

describe("Setup on a fresh install", () => {
  test("shows on start, with the same step and buttons on a paired phone", async () => {
    await fresh();
    const expected = {
      id: "welcome",
      title: "Welcome to Couch",
      body: "Your Mac, made into a TV. Your phone is the remote.",
      step: 0,
      steps: 3,
      buttons: ["Use the Mac's keyboard or mouse for now", "Skip", "Set up later"],
      focus: 0,
    };
    expect(h.screen.last.setup).toEqual(expected);
    const phone = await h.connectPhone();
    expect(phone.last?.setup).toEqual(expected);
  });
});

describe("Setup for a household that already uses Couch", () => {
  const SEEN = ["welcome", "videos", "done"];
  const used: Array<[string, (s: MemoryStore) => void]> = [
    ["a pairing from an earlier start", (s) => s.write("pairing", { key: "k" })],
    ["a Library folder", (s) => s.write("library", { folders: ["/Movies"] })],
    ["Library watch history", (s) => s.write("history", { items: { "/a.mkv": { at: 1 } } })],
    ["Continue watching for an App", (s) => s.write("continue-apps", { items: [{ id: "x" }] })],
  ];
  test.each(used)("never shows with %s, and marks every step seen", async (_, seed) => {
    const store = new MemoryStore();
    seed(store);
    await fresh(store);
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read("setup", undefined)).toEqual({ finished: true, seen: SEEN });
  });
});

describe("moving through Setup", () => {
  test("the Mac's keys and a phone's presses move between steps; Back on the first does nothing", async () => {
    await fresh();
    const phone = await h.connectPhone();
    h.app.screenCommand({ command: "back" });
    expect(h.screen.last.setup?.id).toBe("welcome");
    h.app.screenCommand({ command: "right" });
    expect(h.screen.last.setup?.focus).toBe(1);
    h.app.screenCommand({ command: "left" });
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toMatchObject({ id: "done", step: 2, focus: 0 });
    await phone.settle();
    expect(phone.last?.setup?.id).toBe("done");
    expect(h.screen.last.setup?.tips).toEqual([
      "OK opens",
      "Back steps out",
      "Home always goes Home",
    ]);
    expect(h.screen.last.setup?.buttons).toEqual(["Go to Home"]);
    await phone.press("back");
    expect(h.screen.last.setup?.id).toBe("videos");
    await phone.press({ command: "confirmAnswer", args: { index: 1, text: "videos" } });
    expect(h.screen.last.setup?.id).toBe("done");
    await phone.press({ command: "confirmAnswer", args: { index: 0, text: "welcome" } });
    expect(h.screen.last.setup?.id).toBe("done");
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup).toBeUndefined();
    expect(h.screen.last.state.view).toBe("home");
  });

  test.each([
    ["Home", () => h.app.screenCommand({ command: "home" })],
    ["Set up later", () => h.app.screenCommand({ command: "confirmAt", args: { index: 2 } })],
  ])("%s closes Setup, and it stays closed after a restart", async (_, close) => {
    const store = await fresh();
    close();
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read("setup", undefined)).toEqual({
      finished: true,
      seen: ["welcome", "videos", "done"],
    });
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("a restart in the middle resumes at the first step that isn't done", async () => {
    const store = await fresh();
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup?.id).toBe("done");
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup).toMatchObject({ id: "done", step: 2 });
  });

  test("while open, keys never reach Home or an App", async () => {
    await fresh();
    const phone = await h.connectPhone();
    const view = h.screen.last.state.view;
    const focused = h.screen.last.focusedId;
    for (const command of ["down", "right", "menu", "find", "resume"] as const)
      h.app.screenCommand({ command });
    await phone.press({ command: "openApp", args: { app: "youtube" } });
    await phone.press("openSettings");
    expect(h.screen.last.state.view).toBe(view);
    expect(h.screen.last.focusedId).toBe(focused);
    expect(h.youtube.calls.filter((c) => c.call === "show")).toEqual([]);
  });
});

describe("the videos step", () => {
  const BEFORE = ["welcome", "pair", "listener", "apps"];
  const atVideos = async (extra: Record<string, unknown> = {}) => {
    const store = new MemoryStore();
    store.write("setup", { finished: false, seen: BEFORE });
    for (const [k, v] of Object.entries(extra)) store.write(k, v);
    await fresh(store);
    return store;
  };
  const press = (label: string) => {
    const i = h.screen.last.setup!.buttons.indexOf(label);
    expect(i).toBeGreaterThanOrEqual(0);
    h.app.screenCommand({ command: "confirmAt", args: { index: i } });
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("Add a folder uses the fake picker; the folder is listed and a second can be added", async () => {
    const store = await atVideos();
    expect(h.screen.last.setup).toMatchObject({
      id: "videos",
      buttons: ["Add a folder", "Skip, I only use the Apps", "Set up later"],
    });
    h.mac.folderPick = "/Movies";
    press("Add a folder");
    await settle();
    expect(store.read("library", {})).toEqual({ folders: ["/Movies"] });
    expect(h.screen.last.setup).toMatchObject({
      id: "videos",
      list: ["/Movies"],
      buttons: ["Add more", "Continue", "Skip, I only use the Apps", "Set up later"],
    });
    h.mac.folderPick = "/Shows";
    press("Add more");
    await settle();
    expect(h.screen.last.setup?.list).toEqual(["/Movies", "/Shows"]);
    expect(store.read("library", {})).toEqual({ folders: ["/Movies", "/Shows"] });
    press("Continue");
    expect(h.screen.last.setup?.id).toBe("done");
  });

  test("a cancelled picker adds nothing", async () => {
    await atVideos();
    h.mac.folderPick = undefined;
    press("Add a folder");
    await settle();
    expect(h.screen.last.setup?.list).toBeUndefined();
  });

  test("Skip says it plainly when an App is on, and Skip for now when none is", async () => {
    await atVideos();
    expect(h.screen.last.setup?.buttons[1]).toBe("Skip, I only use the Apps");
    await h.stop();
    await atVideos({
      "home.apps": { order: ["library", "youtube", "netflix"], hidden: ["youtube", "netflix"] },
    });
    expect(h.screen.last.setup?.buttons).toEqual(["Add a folder", "Skip for now", "Set up later"]);
  });

  test("a restart after adding a folder resumes past this step", async () => {
    const store = new MemoryStore();
    store.write("setup", { finished: false, seen: BEFORE });
    store.write("library", { folders: ["/Movies"] });
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("done");
  });
});
