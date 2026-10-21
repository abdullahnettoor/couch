import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

const SPEAKERS = { uid: "BuiltInSpeakerDevice", name: "MacBook Pro Speakers" };
const MONITOR = { uid: "30AEC067-0000-0000-1A24-0104B53C2278", name: "L27h-4A" };

let storeDir: string;
let store: FileStore;
let h: Harness;
let phone: FakePhone;
beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "couch-sound-"));
  store = new FileStore(storeDir);
});
afterEach(async () => {
  await h?.stop();
  rmSync(storeDir, { recursive: true, force: true });
});

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(condition()).toBe(true);
};
const start = async () => {
  h = await startHarness(store);
  phone = await h.connectPhone();
  await settle();
};
const settle = () => new Promise((r) => setTimeout(r, 30));

async function openSoundPage() {
  await phone.press("up");
  await phone.press("ok");
  expect(h.screen.last.state.view).toBe("settings");
  for (let i = 0; i < 4; i++) await phone.press("down");
  await phone.press("ok");
  expect(h.screen.last.state.view).toBe("soundOutput");
}
const rows = () => h.screen.last.grid.map((g) => g.label);

describe("Couch's own volume", () => {
  test("starts at 60 and reaches mpv and YouTube, never the Mac", async () => {
    await start();
    expect(h.player.volume).toBe(60);
    expect(h.youtube.volume).toBe(60);
    expect(phone.last!.volume).toBe(60);
    expect(h.mac.calls.some((c) => c.call.toLowerCase().includes("volume"))).toBe(false);
  });

  test("volUp, volDown and volSet act on it and clamp to 0-100", async () => {
    await start();
    await phone.press("volUp");
    expect(h.player.volume).toBe(65);
    expect(h.youtube.volume).toBe(65);
    await phone.press("volDown");
    await phone.press("volDown");
    expect(h.player.volume).toBe(55);
    await phone.press({ command: "volSet", args: { percent: 250 } });
    expect(h.player.volume).toBe(100);
    expect(h.youtube.volume).toBe(100);
    await phone.press({ command: "volSet", args: { percent: -3 } });
    expect(h.player.volume).toBe(0);
    expect(phone.last!.volume).toBe(0);
  });

  test("is kept in the Store and applied after a restart", async () => {
    await start();
    await phone.press({ command: "volSet", args: { percent: 35 } });
    await h.stop();
    await start();
    expect(phone.last!.volume).toBe(35);
    expect(h.player.volume).toBe(35);
    expect(h.youtube.volume).toBe(35);
  });
});

describe("Sound output", () => {
  test("the page shows System default, then each device", async () => {
    await start();
    await openSoundPage();
    expect(rows()).toEqual(["System default", "MacBook Pro Speakers", "L27h-4A"]);
    expect(h.screen.last.sound).toEqual({ selected: "default", label: "System default" });
  });

  test("choosing a device points mpv (by UID) and YouTube (by name) at it, and is remembered", async () => {
    await start();
    await openSoundPage();
    await phone.press("down");
    await phone.press("down");
    await phone.press("ok");
    expect(h.player.audioDevice).toBe(MONITOR.uid);
    expect(h.youtube.outputName).toBe("L27h-4A");
    expect(h.screen.last.sound).toEqual({ selected: MONITOR.uid, label: "L27h-4A" });
    expect(store.read<{ output?: unknown }>("sound", {}).output).toEqual(MONITOR);
    await h.stop();
    await start();
    expect(h.player.audioDevice).toBe(MONITOR.uid);
    expect(h.youtube.outputName).toBe("L27h-4A");
  });

  test("System default puts both back on the default", async () => {
    store.write("sound", { output: SPEAKERS });
    await start();
    expect(h.player.audioDevice).toBe(SPEAKERS.uid);
    await openSoundPage();
    expect(h.screen.last.focusedId).toBe(`dev:${SPEAKERS.uid}`);
    await phone.press("up");
    await phone.press("ok");
    expect(h.player.audioDevice).toBeUndefined();
    expect(h.youtube.outputName).toBeUndefined();
    expect(store.read<{ output?: unknown }>("sound", {}).output).toBeUndefined();
  });

  test("never touches the Mac's own output or volume", async () => {
    await start();
    await openSoundPage();
    await phone.press("down");
    await phone.press("ok");
    expect(h.mac.calls.map((c) => c.call).filter((c) => /volume|output/i.test(c))).toEqual([]);
  });

  test("a device that isn't connected falls back to System default, says so, and switches back", async () => {
    store.write("sound", { output: MONITOR });
    h = await startHarness(store);
    h.mac.setOutputDevices([SPEAKERS]);
    phone = await h.connectPhone();
    await settle();
    expect(h.player.audioDevice).toBeUndefined();
    await openSoundPage();
    expect(h.screen.last.sound).toEqual({
      selected: "default",
      label: "System default",
      hint: "L27h-4A isn't connected · using System default",
    });
    expect(rows()).toEqual(["System default", "MacBook Pro Speakers"]);

    h.mac.setOutputDevices([SPEAKERS, MONITOR]);
    await until(() => h.player.audioDevice === MONITOR.uid);
    expect(h.youtube.outputName).toBe("L27h-4A");
    expect(h.screen.last.sound).toEqual({ selected: MONITOR.uid, label: "L27h-4A" });
    expect(store.read<{ output?: unknown }>("sound", {}).output).toEqual(MONITOR);
  });

  test("unplugging the chosen device falls back and toasts; plugging it back returns", async () => {
    store.write("sound", { output: MONITOR });
    await start();
    expect(h.player.audioDevice).toBe(MONITOR.uid);
    h.mac.setOutputDevices([SPEAKERS]);
    await until(() => h.player.audioDevice === undefined);
    expect(h.youtube.outputName).toBeUndefined();
    expect(h.screen.last.state.toast).toBe("L27h-4A isn't connected · using System default");
    h.mac.setOutputDevices([SPEAKERS, MONITOR]);
    await until(() => h.player.audioDevice === MONITOR.uid);
    expect(h.screen.last.state.toast).toBe("Back on L27h-4A");
  });

  test("a device YouTube has no output for is said so, and YouTube keeps the System default", async () => {
    h = await startHarness(store);
    h.youtube.unmatchedOutputs.add("L27h-4A");
    phone = await h.connectPhone();
    await openSoundPage();
    await phone.press("down");
    await phone.press("down");
    await phone.press("ok");
    await settle();
    expect(h.player.audioDevice).toBe(MONITOR.uid);
    expect(h.screen.last.state.toast).toBe("YouTube can't play to L27h-4A · using System default");
  });

  test("Back returns to Settings", async () => {
    await start();
    await openSoundPage();
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("settings");
  });
});
