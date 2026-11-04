import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { screenKeyCommand } from "../shared/keyboard.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { MemoryStore } from "./ports/store.ts";
import { Setup } from "./core/setup.ts";
import { SETUP_STEPS, type SetupStep } from "./core/setup-steps.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h?.stop());

const fresh = async (store = new MemoryStore()) => {
  h = await startHarness(store, { setup: "fresh" });
  return store;
};

/** Every step, walked with the way past each: no Skip or Set up later anywhere, never more than two buttons. */
const walk = async () => {
  const seen: Array<{ id: string; buttons: string[] }> = [];
  for (let i = 0; i < 8 && h.screen.last.setup; i++) {
    const s = h.screen.last.setup;
    seen.push({ id: s.id, buttons: s.buttons });
    const past = s.buttons.findIndex((b) => ["Not now", "Continue", "Go to Home"].includes(b));
    h.app.screenCommand({ command: "confirmAt", args: { index: (s.tiles?.length ?? 0) + past } });
    await new Promise((r) => setTimeout(r, 0));
  }
  return seen;
};

describe("Setup on a fresh install", () => {
  test("opens with the intro at Welcome, which is the pairing step; a paired phone shows the same", async () => {
    await fresh();
    expect(h.screen.last.setup).toEqual({
      id: "pair",
      title: "Welcome to Couch",
      body: "Scan with your phone's camera. Your phone becomes the Remote, with no app to install.",
      note: "Your phone needs to be on the same Wi-Fi as this Mac.",
      hint: "No phone nearby? Use the arrow keys and Return.",
      footnote: "You can change all of this later in Settings.",
      qr: true,
      step: 0,
      steps: 5,
      buttons: ["Not now"],
      focus: 0,
      intro: true,
    });
    const phone = await h.connectPhone();
    await phone.settle();
    expect(phone.last?.setup).toEqual(h.screen.last.setup);
  });

  test("the steps are pair, listener, apps, videos, done; none offers Skip or Set up later, none more than two buttons", async () => {
    await fresh();
    const steps = await walk();
    expect(steps.map((s) => s.id)).toEqual(["pair", "listener", "apps", "videos", "done"]);
    for (const { buttons } of steps) {
      expect(buttons.length).toBeLessThanOrEqual(2);
      for (const b of buttons) expect(b).not.toMatch(/skip|set up later/i);
    }
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("the last step has the tips with their keys, the Settings line and one button", async () => {
    const store = new MemoryStore();
    store.write("setup", { finished: false, seen: ["pair", "listener", "apps", "videos"] });
    await fresh(store);
    expect(h.screen.last.setup).toMatchObject({
      id: "done",
      title: "You're set",
      tips: [
        { key: "OK", text: "opens" },
        { key: "Back", text: "steps out" },
        { key: "Home", text: "always goes Home" },
      ],
      footnote: "Change any of this later in Settings.",
      buttons: ["Go to Home"],
      final: true,
    });
  });
});

describe("Setup for a household that already uses Couch", () => {
  const SEEN = ["pair", "listener", "apps", "videos", "done"];
  const used: Array<[string, (s: MemoryStore) => void]> = [
    ["a phone that paired earlier", (s) => s.write("pairing", { key: "k", phonesPaired: true })],
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

describe("an earlier start with no phone paired", () => {
  test("still shows Setup, since the pairing record alone says nothing", async () => {
    const store = new MemoryStore();
    store.write("pairing", { key: "k" });
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("pair");
  });

  test("the first phone to pair is kept, so the next start counts it as used", async () => {
    const store = await fresh();
    expect(store.read<{ phonesPaired?: boolean }>("pairing", {}).phonesPaired).toBeUndefined();
    await h.connectPhone();
    expect(store.read<{ phonesPaired?: boolean }>("pairing", {}).phonesPaired).toBe(true);
  });

  test("Setup resumes past the pairing step once a phone has paired", async () => {
    const store = new MemoryStore();
    store.write("pairing", { key: "k", phonesPaired: true });
    store.write("setup", { finished: false, seen: [] });
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("listener");
  });
});

describe("moving through Setup", () => {
  test("the Mac's keys and a phone's presses move between steps; Back on the first does nothing", async () => {
    await fresh();
    const phone = await h.connectPhone();
    h.clock.advance(1500);
    expect(h.screen.last.setup?.id).toBe("listener");
    h.app.screenCommand({ command: "back" });
    expect(h.screen.last.setup).toMatchObject({ id: "pair", title: "1 phone connected" });
    h.app.screenCommand({ command: "back" });
    expect(h.screen.last.setup?.id).toBe("pair");
    h.app.screenCommand({ command: "right" });
    expect(h.screen.last.setup?.focus).toBe(1);
    h.app.screenCommand({ command: "left" });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup).toMatchObject({ id: "listener", step: 1, focus: 0 });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toMatchObject({ id: "apps", step: 2, focus: 0 });
    h.app.screenCommand({ command: "confirmAt", args: { index: 3 } });
    expect(h.screen.last.setup).toMatchObject({ id: "videos", step: 3, focus: 0 });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toMatchObject({ id: "done", step: 4, focus: 0 });
    await phone.settle();
    expect(phone.last?.setup?.id).toBe("done");
    await phone.press("back");
    expect(h.screen.last.setup?.id).toBe("videos");
    await phone.press("back");
    expect(h.screen.last.setup?.id).toBe("apps");
    await phone.press("back");
    expect(h.screen.last.setup?.id).toBe("listener");
    await phone.press({ command: "confirmAnswer", args: { index: 1, text: "listener" } });
    expect(h.screen.last.setup?.id).toBe("apps");
    await phone.press({ command: "confirmAnswer", args: { index: 0, text: "pair" } });
    expect(h.screen.last.setup?.id).toBe("apps");
    await phone.press({ command: "confirmAnswer", args: { index: 3, text: "apps" } });
    expect(h.screen.last.setup?.id).toBe("videos");
    await phone.press({ command: "confirmAnswer", args: { index: 1, text: "videos" } });
    expect(h.screen.last.setup?.id).toBe("done");
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup).toBeUndefined();
    expect(h.screen.last.state.view).toBe("home");
  });

  test("Back on the first step does nothing", async () => {
    await fresh();
    h.app.screenCommand({ command: "back" });
    expect(h.screen.last.setup).toMatchObject({ id: "pair", title: "Welcome to Couch" });
  });

  test.each([
    ["Home on the Remote", () => h.app.screenCommand({ command: "home" })],
    ["h on the Mac", () => h.app.screenCommand(screenKeyCommand({ key: "h" }, false)!)],
  ])("%s closes Setup silently, and it stays closed after a restart", async (_, close) => {
    const store = await fresh();
    h.app.screenCommand({ command: "ok" });
    close();
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read("setup", undefined)).toEqual({
      finished: true,
      seen: ["pair", "listener", "apps", "videos", "done"],
    });
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("a restart in the middle resumes at the first step that isn't done", async () => {
    const store = await fresh();
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup?.id).toBe("listener");
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup?.id).toBe("apps");
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup).toMatchObject({ id: "apps", step: 2, intro: true });
  });

  test("an old saved Welcome step is harmless", async () => {
    const store = new MemoryStore();
    store.write("setup", { finished: false, seen: ["welcome", "pair"] });
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("listener");
    await h.stop();
    store.write("setup", {
      finished: true,
      seen: ["welcome", "pair", "listener", "apps", "videos", "done"],
    });
    await fresh(store);
    expect(h.screen.last.setup).toBeUndefined();
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

describe("⌘Q during Setup", () => {
  const quits = () => h.mac.calls.filter((c) => c.call === "quit");

  test("Quit Couch? takes the keys over Setup; dismissing it returns to Setup at the same step", async () => {
    await fresh();
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "right" });
    expect(h.screen.last.setup).toMatchObject({ id: "listener", focus: 1 });
    h.app.askQuit();
    expect(h.screen.last.state.confirm).toEqual({
      title: "Quit Couch?",
      buttons: ["Cancel", "Quit"],
      focus: 0,
    });
    h.app.screenCommand({ command: "right" });
    expect(h.screen.last.state.confirm?.focus).toBe(1);
    h.app.screenCommand({ command: "left" });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.state.confirm).toBeUndefined();
    expect(quits()).toHaveLength(0);
    expect(h.screen.last.setup).toMatchObject({ id: "listener", focus: 1 });

    h.app.askQuit();
    h.app.screenCommand({ command: "back" });
    expect(h.screen.last.state.confirm).toBeUndefined();
    expect(h.screen.last.setup).toMatchObject({ id: "listener", focus: 1 });

    h.app.askQuit();
    h.app.screenCommand({ command: "right" });
    h.app.screenCommand({ command: "ok" });
    expect(quits()).toHaveLength(1);
  });
});

describe("the Listener step", () => {
  const toListener = async () => {
    const store = await fresh();
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup?.id).toBe("listener");
    return store;
  };
  const loginItemCalls = () => h.mac.calls.filter((c) => c.call === "setListenerLoginItem");

  test("Turn on is first and focused, and turns the login item on; Settings shows it on", async () => {
    await toListener();
    expect(h.screen.last.setup).toEqual({
      id: "listener",
      title: "Start Couch from your phone",
      body: "With this on, the Power button on your phone can open Couch even after it's been closed. A tiny helper starts when you log in to this Mac and waits for the button. It uses almost no power.",
      note: "macOS will say a background item was added. That's this helper.",
      step: 1,
      steps: 5,
      buttons: ["Turn on", "Not now"],
      focus: 0,
      intro: true,
    });
    h.app.screenCommand({ command: "ok" });
    const p = await h.connectPhone();
    await p.settle();
    expect(h.mac.loginItem.on).toBe(true);
    expect(h.screen.last.setup?.id).toBe("apps");
    h.app.screenCommand({ command: "home" });
    await p.press("down");
    await p.press("right");
    await p.press("right");
    await p.press("ok");
    await p.press("up");
    await p.press("ok");
    await p.press("ok");
    await p.settle();
    expect(h.screen.last.state.view).toBe("settingsRemotes");
    expect(h.screen.last.listener?.on).toBe(true);
  });

  test("Not now leaves it off, and the answer survives a restart", async () => {
    const store = await toListener();
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    await h.app.core.refreshLoginItem();
    expect(loginItemCalls()).toEqual([]);
    expect(h.mac.loginItem.on).toBe(false);
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("apps");
  });

  test("with the Listener already on, the step says so and offers Continue", async () => {
    const store = new MemoryStore();
    h = await startHarness(store, { setup: "fresh", loginItemOn: true });
    await h.app.core.refreshLoginItem();
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup).toMatchObject({
      id: "listener",
      title: "Couch starts from your phone",
      buttons: ["Continue"],
    });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup?.id).toBe("apps");
    expect(loginItemCalls()).toEqual([]);
  });
});

describe("New in Couch: steps added by an update", () => {
  const fake: SetupStep = {
    id: "remote-style",
    done: () => false,
    page: () => ({ title: "Remote style", buttons: [{ label: "Pick one", run: (c) => c.next() }] }),
  };
  const steps = [...SETUP_STEPS.slice(0, -1), fake, SETUP_STEPS.at(-1)!];
  const start = async (store: MemoryStore, options: { setup?: "fresh" } = {}) => {
    h = await startHarness(store, { ...options, setupSteps: steps });
  };
  const finished = () => {
    const store = new MemoryStore();
    store.write("setup", {
      finished: true,
      seen: ["pair", "listener", "apps", "videos", "done"],
    });
    return store;
  };
  const later = () => h.app.screenCommand({ command: "home" });

  test("a restart shows only the new step, titled with the version, and marks it seen when done", async () => {
    const store = finished();
    await start(store);
    expect(h.screen.last.setup).toEqual({
      id: "remote-style",
      title: "New in Couch 0.2.0",
      body: "Remote style",
      step: 0,
      steps: 1,
      buttons: ["Pick one"],
      focus: 0,
    });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read("setup", undefined)).toMatchObject({
      finished: true,
      seen: ["pair", "listener", "apps", "videos", "done", "remote-style"],
    });
    await h.stop();
    await start(store);
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("with no new step nothing shows", async () => {
    h = await startHarness(finished());
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("waits behind the Library player after Power and Resume", async () => {
    const root = mkdtempSync(join(tmpdir(), "couch-setup-"));
    const file = join(root, "A.Film.2001.mkv");
    writeFileSync(file, "");
    const store = finished();
    store.write("library", { folders: [root] });
    store.write("history", { items: { [file]: { at: 1, position: 600, duration: 7200 } } });
    try {
      await start(store);
      h.app.screenCommand({ command: "resume" });
      expect(h.screen.last.state.view).toBe("player");
      expect(h.screen.last.setup).toBeUndefined();
      h.app.screenCommand({ command: "back" });
      expect(h.screen.last.state.view).toBe("home");
      expect(h.screen.last.setup?.id).toBe("remote-style");
    } finally {
      await h?.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("waits behind a web App after Power and Resume", async () => {
    const store = finished();
    store.write("continue-apps", {
      items: [
        {
          app: "youtube",
          title: "Cat video",
          url: "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=300",
          position: 300,
          duration: 3000,
          at: 1,
        },
      ],
    });
    await start(store);
    h.app.screenCommand({ command: "resume" });
    expect(h.screen.last.state.view).toBe("app");
    expect(h.screen.last.setup).toBeUndefined();
    h.app.screenCommand({ command: "home" });
    expect(h.screen.last.setup?.id).toBe("remote-style");
  });

  test("Home once asks again on the next start; a second time doesn't", async () => {
    const defer = later;
    const store = finished();
    await start(store);
    defer();
    expect(h.screen.last.setup).toBeUndefined();
    await h.stop();
    await start(store);
    expect(h.screen.last.setup?.id).toBe("remote-style");
    defer();
    await h.stop();
    await start(store);
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read<{ seen?: string[] }>("setup", {}).seen).toContain("remote-style");
  });

  test("a phone connecting never un-finishes Setup, even while the steps wait behind playback", async () => {
    const store = finished();
    await start(store);
    await h.connectPhone();
    expect(store.read("setup", undefined)).toMatchObject({ finished: true });
    h.app.screenCommand({ command: "ok" });
    await h.stop();
    await start(store);
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("a fresh install that finishes Setup never sees New in Couch for its steps", async () => {
    const store = new MemoryStore();
    await start(store, { setup: "fresh" });
    expect(h.screen.last.setup?.title).toBe("Welcome to Couch");
    later();
    await h.stop();
    await start(store);
    expect(h.screen.last.setup).toBeUndefined();
  });
});

describe("the videos step", () => {
  const BEFORE = ["pair", "listener", "apps"];
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
      body: "Choose the folders your films and shows are in. Couch adds them to the Library.",
      buttons: ["Add a folder", "Not now"],
    });
    h.mac.folderPick = "/Movies";
    press("Add a folder");
    await settle();
    expect(store.read("library", {})).toEqual({ folders: ["/Movies"] });
    expect(h.screen.last.setup).toMatchObject({
      id: "videos",
      list: ["/Movies"],
      buttons: ["Continue", "Add more"],
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

  test("Not now moves on with no folder", async () => {
    await atVideos();
    press("Not now");
    expect(h.screen.last.setup?.id).toBe("done");
  });

  test("a restart after adding a folder resumes past this step", async () => {
    const store = new MemoryStore();
    store.write("setup", { finished: false, seen: BEFORE });
    store.write("library", { folders: ["/Movies"] });
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("done");
  });
});

describe("the Pair your phone step", () => {
  test("shows the QR step; a phone connecting shows Phone connected, then moves on after 1.5 s", async () => {
    await fresh();
    expect(h.screen.last.setup).toMatchObject({
      id: "pair",
      title: "Welcome to Couch",
      qr: true,
      step: 0,
      buttons: ["Not now"],
    });
    const phone = await h.connectPhone();
    expect(h.screen.last.setup).toMatchObject({
      id: "pair",
      title: "Phone connected",
      connected: true,
    });
    expect(h.screen.last.setup?.qr).toBeUndefined();
    h.clock.advance(1400);
    expect(h.screen.last.setup?.id).toBe("pair");
    h.clock.advance(100);
    expect(h.screen.last.setup?.id).toBe("listener");
    await phone.settle();
    expect(phone.last?.setup?.id).toBe("listener");
  });

  test("with a phone already connected it waits, with Continue and Add another phone", async () => {
    await fresh();
    await h.connectPhone();
    h.clock.advance(1500);
    h.app.screenCommand({ command: "back" });
    expect(h.screen.last.setup).toMatchObject({
      title: "1 phone connected",
      buttons: ["Continue", "Add another phone"],
    });
    h.clock.advance(5000);
    expect(h.screen.last.setup?.id).toBe("pair");
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toMatchObject({ id: "pair", qr: true, buttons: ["Not now"] });
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup?.id).toBe("listener");
    h.app.screenCommand({ command: "back" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup?.id).toBe("listener");
  });

  test("a restart after pairing resumes past it", async () => {
    const store = await fresh();
    await h.connectPhone();
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("listener");
  });

  test("Not now moves on", async () => {
    await fresh();
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup?.id).toBe("listener");
  });
});

describe("the Apps step", () => {
  const toApps = async (store = new MemoryStore(), options = {}) => {
    h = await startHarness(store, { setup: "fresh", ...options });
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup?.id).toBe("apps");
  };
  const homeLabels = () =>
    h.screen.last.grid.filter((i) => i.id !== "settings" && i.r === 1).map((i) => i.label);

  test("on a fresh store lists every App as a tile with its logo, YouTube and Netflix on; OK changes Home and Settings", async () => {
    await toApps();
    const icons = new Map(h.screen.last.homeApps?.map((a) => [a.id, a.icon]));
    expect(h.screen.last.setup).toMatchObject({
      title: "Pick your Apps",
      tiles: [
        { id: "youtube", label: "YouTube", icon: icons.get("youtube"), on: true },
        { id: "netflix", label: "Netflix", icon: icons.get("netflix"), on: true },
        { id: "library", label: "Library", icon: icons.get("library"), on: true },
      ],
      columns: 3,
      buttons: ["Continue"],
      focus: 0,
    });
    expect(icons.get("youtube")).toContain("<svg");
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup?.tiles?.map((s) => s.on)).toEqual([false, true, true]);
    expect(h.screen.last.homeApps?.map((a) => [a.id, a.shown])).toEqual([
      ["youtube", false],
      ["netflix", true],
      ["library", true],
    ]);
    h.app.screenCommand({ command: "confirmAt", args: { index: 3 } });
    expect(h.screen.last.setup?.id).toBe("videos");
    expect(homeLabels()).toEqual(["Netflix", "Library"]);
  });

  test("arrows move in the grid, Down reaches Continue and Up comes back; a phone's answer uses the same indexes", async () => {
    await toApps();
    const phone = await h.connectPhone();
    const focus = () => h.screen.last.setup?.focus;
    h.app.screenCommand({ command: "left" });
    expect(focus()).toBe(0);
    h.app.screenCommand({ command: "right" });
    expect(focus()).toBe(1);
    h.app.screenCommand({ command: "up" });
    expect(focus()).toBe(1);
    h.app.screenCommand({ command: "down" });
    expect(focus()).toBe(3);
    h.app.screenCommand({ command: "down" });
    expect(focus()).toBe(3);
    h.app.screenCommand({ command: "up" });
    expect(focus()).toBe(1);
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup?.tiles?.[1]?.on).toBe(false);
    await phone.press({ command: "confirmAnswer", args: { index: 0, text: "apps" } });
    expect(h.screen.last.setup?.tiles?.[0]?.on).toBe(false);
    expect(phone.last?.setup?.tiles?.map((s) => s.on)).toEqual([false, false, true]);
    expect(phone.last?.setup?.tiles?.[0]?.icon).toContain("<svg");
    await phone.press({ command: "confirmAnswer", args: { index: 3, text: "apps" } });
    expect(h.screen.last.setup?.id).toBe("videos");
  });

  test("a phone's index past the last control is ignored", async () => {
    await toApps();
    const phone = await h.connectPhone();
    await phone.press({ command: "confirmAnswer", args: { index: 6, text: "apps" } });
    expect(h.screen.last.setup?.id).toBe("apps");
    expect(h.screen.last.setup?.tiles?.map((s) => s.on)).toEqual([true, true, true]);
  });

  test("every App off is allowed, and Home shows no App tiles", async () => {
    await toApps();
    for (let i = 0; i < 3; i++) h.app.screenCommand({ command: "confirmAt", args: { index: i } });
    expect(h.screen.last.setup?.tiles?.map((s) => s.on)).toEqual([false, false, false]);
    expect(homeLabels()).toEqual([]);
  });

  test("an App that declares itself off by default starts off", async () => {
    const entry = {
      id: "extra",
      label: "Extra",
      icon: "<svg/>",
      action: "app:open:extra",
      web: true,
      onByDefault: false,
    };
    await toApps(new MemoryStore(), { apps: [{ entry, app: new FakeWebApp("extra", "Extra") }] });
    expect(h.screen.last.setup?.tiles?.find((s) => s.label === "Extra")?.on).toBe(false);
  });
});

describe("Settings → About → Run setup again", () => {
  const SEEN = ["pair", "listener", "apps", "videos", "done"];
  const flush = () => new Promise((r) => setTimeout(r, 0));

  async function openAbout(store = new MemoryStore(), options = {}) {
    h = await startHarness(store, options);
    const phone = await h.connectPhone();
    await phone.press("openSettings");
    for (let i = 0; i < 12 && h.screen.last.focusedLabel !== "About"; i++)
      await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("about");
    return { phone, store };
  }
  const runAgain = async (phone: Awaited<ReturnType<typeof openAbout>>["phone"]) => {
    expect(h.screen.last.grid.map((i) => i.label)).toContain("Run setup again");
    for (let i = 0; i < 6 && h.screen.last.focusedLabel !== "Run setup again"; i++)
      await phone.press("down");
    await phone.press("ok");
  };
  const press = (label: string) => {
    const i =
      h.screen.last.setup!.buttons.indexOf(label) + (h.screen.last.setup!.tiles?.length ?? 0);
    expect(i).toBeGreaterThanOrEqual(0);
    h.app.screenCommand({ command: "confirmAt", args: { index: i } });
  };

  test("About lists it; OK opens Setup at Welcome, with no intro", async () => {
    const { phone } = await openAbout();
    await runAgain(phone);
    expect(h.screen.last.setup).toMatchObject({ id: "pair", step: 0 });
    expect(h.screen.last.setup?.intro).toBeUndefined();
    expect(h.screen.last.state.view).toBe("home");
  });

  test("with a phone and folders already there, those steps show their Continue versions", async () => {
    const store = new MemoryStore();
    store.write("library", { folders: ["/Movies"] });
    const { phone } = await openAbout(store, { loginItemOn: true });
    await runAgain(phone);
    expect(h.screen.last.setup).toMatchObject({
      id: "pair",
      title: "1 phone connected",
      buttons: ["Continue", "Add another phone"],
    });
    press("Continue");
    expect(h.screen.last.setup).toMatchObject({
      id: "listener",
      buttons: ["Continue"],
    });
    press("Continue");
    press("Continue");
    expect(h.screen.last.setup).toMatchObject({
      id: "videos",
      list: ["/Movies"],
      buttons: ["Continue", "Add more"],
    });
  });

  test("closing goes Home, leaves the seen set alone, and Setup doesn't show on the next start", async () => {
    const store = new MemoryStore();
    store.write("setup", { finished: true, seen: SEEN });
    const { phone } = await openAbout(store);
    await runAgain(phone);
    h.app.screenCommand({ command: "home" });
    await flush();
    expect(h.screen.last.setup).toBeUndefined();
    expect(h.screen.last.state.view).toBe("home");
    expect(store.read("setup", undefined)).toEqual({ finished: true, seen: SEEN });
    await h.stop();
    h = await startHarness(store);
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("finishing a re-run while an update's steps are pending doesn't open them at once", () => {
    const fake: SetupStep = {
      id: "remote-style",
      done: () => false,
      page: () => ({ title: "Remote style", buttons: [{ label: "Pick", run: (c) => c.next() }] }),
    };
    const store = new MemoryStore();
    store.write("setup", { finished: true, seen: SEEN });
    const setup = new Setup(
      {
        store,
        apps: { rows: () => [], setShown: () => {} },
        usedBefore: () => true,
        listenerOn: () => false,
        turnListenerOn: () => {},
        atHome: () => true,
        version: () => "0.2.0",
        phones: () => 0,
        phonePaired: () => false,
        folders: () => [],
        addFolder: () => {},
        later: () => () => {},
        cue: () => {},
        changed: () => {},
      },
      [...SETUP_STEPS.slice(0, -1), fake, SETUP_STEPS.at(-1)!],
    );
    expect(setup.payload()?.id).toBe("remote-style");
    setup.rerun();
    expect(setup.payload()?.id).toBe("pair");
    setup.handle({ command: "home" });
    expect(setup.payload()).toBeUndefined();
    expect(store.read("setup", undefined)).toEqual({ finished: true, seen: SEEN });
  });

  test("going through it to the end changes nothing saved, and shows no New in Couch", async () => {
    const store = new MemoryStore();
    const { phone } = await openAbout(store);
    const before = store.read("setup", undefined);
    await runAgain(phone);
    expect((await walk()).map((s) => s.id)).toEqual(["pair", "listener", "apps", "videos", "done"]);
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read("setup", undefined)).toEqual(before);
  });
});
