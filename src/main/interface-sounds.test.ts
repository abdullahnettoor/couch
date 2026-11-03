import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { Command } from "../shared/protocol.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { FileStore } from "./ports/store.ts";
import { focusFolders, startHarness, type Harness } from "./testing/harness.ts";

let storeDir: string;
let store: FileStore;
let h: Harness;
beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "couch-ui-sounds-"));
  store = new FileStore(storeDir);
});
afterEach(async () => {
  await h?.stop();
  rmSync(storeDir, { recursive: true, force: true });
});

const tube = () => new FakeWebApp("tube", "Tube", { adapter: true });
const start = async (app?: FakeWebApp) => {
  h = await startHarness(
    store,
    app
      ? {
          apps: [
            {
              entry: { id: "tube", label: "Tube", icon: "", action: "app:open:tube", web: true },
              app,
            },
          ],
        }
      : {},
  );
};
const press = (command: Command["command"] | Command) =>
  h.app.screenCommand(typeof command === "string" ? { command } : command);
/** The sounds the next presses ask for. */
const heard = (...commands: Array<Command["command"] | Command>) => {
  const from = h.screen.sounds.length;
  for (const c of commands) press(c);
  return h.screen.sounds.slice(from).map((s) => s.sound);
};
const view = () => h.screen.last.state.view;

describe("Interface sounds", () => {
  test("a move ticks, the end of a list bumps, OK selects and Back goes back", async () => {
    await start();
    press("openSettings");
    expect(view()).toBe("settings");
    expect(heard("down", "up")).toEqual(["move", "move"]);
    expect(heard("up")).toEqual(["blocked"]);
    expect(heard("ok")).toEqual(["select"]);
    expect(view()).toBe("settingsRemotes");
    expect(heard("back", "back")).toEqual(["back", "back"]);
    expect(view()).toBe("home");
  });

  test("Back with nowhere to go and a mouse hover make no sound", async () => {
    await start();
    expect(heard("back")).toEqual([]);
    expect(heard({ command: "focusAt", args: { r: 0, c: 0 } })).toEqual([]);
  });

  test("a question's buttons tick and bump; Back dismisses it", async () => {
    await start();
    press("openSettings");
    for (let i = 0; i < 6; i++) press("down");
    press("ok");
    expect(h.screen.last.state.confirm?.title).toBe("Quit Couch?");
    expect(heard("right", "right", "left")).toEqual(["move", "blocked", "move"]);
    expect(heard("back")).toEqual(["back"]);
    expect(h.screen.last.state.confirm).toBeUndefined();
  });

  test("Quick settings over Home: Down ticks, Back closes it", async () => {
    await start();
    press("quickSettings");
    expect(h.screen.last.quick).toBeDefined();
    expect(heard("up", "down")).toEqual(["blocked", "move"]);
    expect(heard("back")).toEqual(["back"]);
    expect(h.screen.last.quick).toBeUndefined();
  });

  test("carry Couch's volume and the Sound output in use; silent while muted", async () => {
    await start();
    press({ command: "volSet", args: { percent: 30 } });
    press("openSettings");
    press("down");
    expect(h.screen.sounds.at(-1)).toEqual({ sound: "move", volume: 30 });
    press("mute");
    expect(heard("down", "up")).toEqual([]);
  });

  test("nothing while a web App is in front, from opening it to leaving it", async () => {
    await start(tube());
    for (let i = 0; i < 10 && h.screen.last.focusedId !== "tube"; i++) press("right");
    expect(heard("ok", "left", "right", "up", "down", "ok")).toEqual([]);
    expect(view()).toBe("app");
    press("home");
    expect(view()).toBe("home");
    expect(heard("left")).not.toEqual([]);
  });
});

describe("Interface sounds during Library playback", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "couch-ui-play-"));
    mkdirSync(join(root, "Movies"));
    writeFileSync(join(root, "Movies", "Dune.2021.1080p.mkv"), "");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("nothing while a video plays, its controls included", async () => {
    store.write("library", { folders: [root] });
    await start();
    const phone = await h.connectPhone();
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok");
    expect(view()).toBe("library");
    await focusFolders(h, phone);
    await phone.press("ok");
    await phone.press("ok");
    const from = h.screen.sounds.length;
    await phone.press("ok");
    expect(view()).toBe("player");
    h.player.emit({ type: "duration", seconds: 600 });
    expect(heard("up", "down", "left", "right", "ok", "back")).toEqual([]);
    expect(h.screen.sounds.length).toBe(from);
  });
});

describe("Settings → Sound output → Interface sounds", () => {
  const openSoundPage = () => {
    press("openSettings");
    press("down");
    press("down");
    press("ok");
    expect(view()).toBe("soundOutput");
    for (let i = 0; i < 10; i++) press("down");
    expect(h.screen.last.focusedId).toBe("interface-sounds");
  };

  test("is On by default, last on the page", async () => {
    await start();
    openSoundPage();
    expect(h.screen.last.grid.at(-1)?.label).toBe("Interface sounds");
    expect(h.screen.last.interfaceSounds).toBe(true);
  });

  test("OK turns it off: the Screen goes quiet, and stays so after a restart", async () => {
    await start();
    openSoundPage();
    expect(heard("ok")).toEqual([]);
    expect(h.screen.last.interfaceSounds).toBe(false);
    expect(heard("up", "down", "back")).toEqual([]);
    await h.stop();
    await start();
    expect(store.read("interface-sounds", {})).toEqual({ on: false });
    expect(heard("openSettings", "down", "up", "back")).toEqual([]);
  });

  test("turning it back on clicks", async () => {
    store.write("interface-sounds", { on: false });
    await start();
    openSoundPage();
    expect(h.screen.last.interfaceSounds).toBe(false);
    expect(heard("ok")).toEqual(["select"]);
    expect(h.screen.last.interfaceSounds).toBe(true);
  });
});
