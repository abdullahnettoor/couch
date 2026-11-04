import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { FakeWebApp } from "./ports/fakes.ts";
import { MemoryStore } from "./ports/store.ts";
import { SETUP_STEPS, type SetupStep } from "./core/setup-steps.ts";
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
      steps: 6,
      buttons: ["Use the Mac's keyboard or mouse for now", "Skip", "Set up later"],
      focus: 0,
    };
    expect(h.screen.last.setup).toEqual(expected);
    const phone = await h.connectPhone();
    expect(phone.last?.setup).toEqual(expected);
  });
});

describe("Setup for a household that already uses Couch", () => {
  const SEEN = ["welcome", "pair", "listener", "apps", "videos", "done"];
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
    expect(h.screen.last.setup).toMatchObject({ id: "pair", step: 1, focus: 0 });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup).toMatchObject({ id: "listener", step: 2, focus: 0 });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toMatchObject({ id: "apps", step: 3, focus: 0 });
    h.app.screenCommand({ command: "confirmAt", args: { index: 3 } });
    expect(h.screen.last.setup).toMatchObject({ id: "videos", step: 4, focus: 0 });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toMatchObject({ id: "done", step: 5, focus: 0 });
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
    await phone.press("back");
    expect(h.screen.last.setup?.id).toBe("apps");
    await phone.press("back");
    expect(h.screen.last.setup?.id).toBe("listener");
    await phone.press({
      command: "confirmAnswer",
      args: { index: 2, text: "listener" },
    });
    expect(h.screen.last.setup?.id).toBe("apps");
    await phone.press({ command: "confirmAnswer", args: { index: 0, text: "welcome" } });
    expect(h.screen.last.setup?.id).toBe("apps");
    await phone.press({ command: "confirmAnswer", args: { index: 0, text: "apps" } });
    expect(h.screen.last.setup?.id).toBe("videos");
    await phone.press({ command: "confirmAnswer", args: { index: 1, text: "videos" } });
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
      seen: ["welcome", "pair", "listener", "apps", "videos", "done"],
    });
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("a restart in the middle resumes at the first step that isn't done", async () => {
    const store = await fresh();
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup?.id).toBe("pair");
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup?.id).toBe("listener");
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup?.id).toBe("apps");
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup).toMatchObject({ id: "apps", step: 3 });
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

describe("the Listener step", () => {
  const toListener = async () => {
    const store = await fresh();
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup?.id).toBe("listener");
    return store;
  };
  const loginItemCalls = () => h.mac.calls.filter((c) => c.call === "setListenerLoginItem");

  test("Yes is first and focused, and turns the login item on; Settings shows it on", async () => {
    await toListener();
    expect(h.screen.last.setup).toMatchObject({
      title: "Turn Couch on from your phone?",
      buttons: ["Yes", "No", "Skip", "Set up later"],
      focus: 0,
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

  test("No leaves it off, and the answer survives a restart", async () => {
    const store = await toListener();
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    await h.app.core.refreshLoginItem();
    expect(loginItemCalls()).toEqual([]);
    expect(h.mac.loginItem.on).toBe(false);
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("apps");
  });

  test("Skip leaves it off", async () => {
    await toListener();
    h.app.screenCommand({ command: "confirmAt", args: { index: 2 } });
    expect(loginItemCalls()).toEqual([]);
    expect(h.screen.last.setup?.id).toBe("apps");
  });

  test("with the Listener already on, the step says so and offers Continue", async () => {
    const store = new MemoryStore();
    h = await startHarness(store, { setup: "fresh", loginItemOn: true });
    await h.app.core.refreshLoginItem();
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup).toMatchObject({
      id: "listener",
      title: "Couch is on from your phone",
      buttons: ["Continue", "Skip", "Set up later"],
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
      seen: ["welcome", "pair", "listener", "apps", "videos", "done"],
    });
    return store;
  };
  const later = () => h.app.screenCommand({ command: "confirmAt", args: { index: 2 } });

  test("a restart shows only the new step, titled with the version, and marks it seen when done", async () => {
    const store = finished();
    await start(store);
    expect(h.screen.last.setup).toEqual({
      id: "remote-style",
      title: "New in Couch 0.2.0",
      body: "Remote style",
      step: 0,
      steps: 1,
      buttons: ["Pick one", "Skip", "Set up later"],
      focus: 0,
    });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read("setup", undefined)).toMatchObject({
      finished: true,
      seen: ["welcome", "pair", "listener", "apps", "videos", "done", "remote-style"],
    });
    await h.stop();
    await start(store);
    expect(h.screen.last.setup).toBeUndefined();
  });

  test("Skip marks the step seen too", async () => {
    const store = finished();
    await start(store);
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read<{ seen?: string[] }>("setup", {}).seen).toContain("remote-style");
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

  test.each([
    ["Later", later],
    ["Home", () => h.app.screenCommand({ command: "home" })],
  ])("%s once asks again on the next start; a second time doesn't", async (_, defer) => {
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

describe("the Pair your phone step", () => {
  const toPair = () => h.app.screenCommand({ command: "ok" });

  test("shows the QR step; a phone connecting shows Phone connected, then moves on after 1.5 s", async () => {
    await fresh();
    toPair();
    expect(h.screen.last.setup).toMatchObject({
      id: "pair",
      title: "Pair your phone",
      qr: true,
      step: 1,
      buttons: ["Skip for now", "Set up later"],
    });
    expect(h.screen.last.setup?.body).toContain("same Wi-Fi");
    const phone = await h.connectPhone();
    expect(h.screen.last.setup).toMatchObject({ id: "pair", title: "Phone connected" });
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
    toPair();
    expect(h.screen.last.setup).toMatchObject({
      title: "1 phone connected",
      buttons: ["Continue", "Add another phone", "Skip for now", "Set up later"],
    });
    h.clock.advance(5000);
    expect(h.screen.last.setup?.id).toBe("pair");
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup).toMatchObject({ id: "pair", qr: true });
    h.app.screenCommand({ command: "back" });
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup?.id).toBe("listener");
  });

  test("a restart after pairing resumes past it", async () => {
    const store = await fresh();
    toPair();
    await h.connectPhone();
    await h.stop();
    await fresh(store);
    expect(h.screen.last.setup?.id).toBe("listener");
  });

  test("Skip for now moves on", async () => {
    await fresh();
    toPair();
    h.app.screenCommand({ command: "confirmAt", args: { index: 0 } });
    expect(h.screen.last.setup?.id).toBe("listener");
  });
});

describe("the Apps step", () => {
  const toApps = async (store = new MemoryStore(), options = {}) => {
    h = await startHarness(store, { setup: "fresh", ...options });
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "ok" });
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup?.id).toBe("apps");
  };
  const homeLabels = () =>
    h.screen.last.grid.filter((i) => i.id !== "settings" && i.r === 1).map((i) => i.label);

  test("on a fresh store lists every App, YouTube and Netflix on; a switch changes Home and Settings", async () => {
    await toApps();
    expect(h.screen.last.setup).toMatchObject({
      title: "Which Apps show on Home?",
      switches: [
        { label: "YouTube", on: true },
        { label: "Netflix", on: true },
        { label: "Library", on: true },
      ],
      buttons: ["Continue", "Skip", "Set up later"],
      focus: 0,
    });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.setup?.switches?.map((s) => s.on)).toEqual([false, true, true]);
    expect(h.screen.last.homeApps?.map((a) => [a.id, a.shown])).toEqual([
      ["youtube", false],
      ["netflix", true],
      ["library", true],
    ]);
    h.app.screenCommand({ command: "confirmAt", args: { index: 3 } });
    expect(h.screen.last.setup?.id).toBe("videos");
    expect(homeLabels()).toEqual(["Netflix", "Library"]);
  });

  test("Up and Down move between the switches and buttons; a phone's answer indexes the buttons", async () => {
    await toApps();
    const phone = await h.connectPhone();
    h.app.screenCommand({ command: "down" });
    expect(h.screen.last.setup?.focus).toBe(1);
    h.app.screenCommand({ command: "confirmAt", args: { index: 1 } });
    expect(h.screen.last.setup?.switches?.[1]?.on).toBe(false);
    await phone.press({ command: "confirmAnswer", args: { index: 0, text: "apps" } });
    expect(h.screen.last.setup?.id).toBe("videos");
  });

  test("every App off is allowed, and Home shows no App tiles", async () => {
    await toApps();
    for (let i = 0; i < 3; i++) h.app.screenCommand({ command: "confirmAt", args: { index: i } });
    expect(h.screen.last.setup?.switches?.map((s) => s.on)).toEqual([false, false, false]);
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
    expect(h.screen.last.setup?.switches?.find((s) => s.label === "Extra")?.on).toBe(false);
  });
});

describe("Settings → About → Run setup again", () => {
  const SEEN = ["welcome", "pair", "listener", "apps", "videos", "done"];
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
      h.screen.last.setup!.buttons.indexOf(label) + (h.screen.last.setup!.switches?.length ?? 0);
    expect(i).toBeGreaterThanOrEqual(0);
    h.app.screenCommand({ command: "confirmAt", args: { index: i } });
  };

  test("About lists it; OK opens Setup at Welcome", async () => {
    const { phone } = await openAbout();
    await runAgain(phone);
    expect(h.screen.last.setup).toMatchObject({ id: "welcome", step: 0 });
    expect(h.screen.last.state.view).toBe("home");
  });

  test("with a phone and folders already there, those steps show their Continue versions", async () => {
    const store = new MemoryStore();
    store.write("library", { folders: ["/Movies"] });
    const { phone } = await openAbout(store, { loginItemOn: true });
    await runAgain(phone);
    press("Use the Mac's keyboard or mouse for now");
    expect(h.screen.last.setup).toMatchObject({
      id: "pair",
      title: "1 phone connected",
      buttons: ["Continue", "Add another phone", "Skip for now", "Set up later"],
    });
    press("Continue");
    expect(h.screen.last.setup).toMatchObject({
      id: "listener",
      buttons: expect.arrayContaining(["Continue"]),
    });
    press("Continue");
    press("Continue");
    expect(h.screen.last.setup).toMatchObject({
      id: "videos",
      list: ["/Movies"],
      buttons: ["Add more", "Continue", "Skip, I only use the Apps", "Set up later"],
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

  test("going through it to the end changes nothing saved, and shows no New in Couch", async () => {
    const store = new MemoryStore();
    const { phone } = await openAbout(store);
    const before = store.read("setup", undefined);
    await runAgain(phone);
    for (let i = 0; i < 12 && h.screen.last.setup; i++) {
      h.app.screenCommand({
        command: "confirmAt",
        args: {
          index:
            h.screen.last.setup.id === "done"
              ? 0
              : (h.screen.last.setup.switches?.length ?? 0) +
                h.screen.last.setup.buttons.length -
                2,
        },
      });
      await flush();
    }
    expect(h.screen.last.setup).toBeUndefined();
    expect(store.read("setup", undefined)).toEqual(before);
  });
});
