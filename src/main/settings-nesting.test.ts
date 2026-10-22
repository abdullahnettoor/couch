import { afterEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

const labels = () => h.screen.last.grid.map((i) => i.label);
const view = () => h.screen.last.state.view;

async function openSettings(): Promise<FakePhone> {
  h = await startHarness();
  const phone = await h.connectPhone();
  await phone.press("up");
  await phone.press("ok");
  return phone;
}

async function enter(phone: FakePhone, label: string) {
  const target = h.screen.last.grid.findIndex((i) => i.label === label);
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== label; i++) {
    const at = h.screen.last.grid.findIndex((g) => g.id === h.screen.last.focusedId);
    await phone.press(target > at ? "down" : "up");
  }
  expect(h.screen.last.focusedLabel).toBe(label);
  await phone.press("ok");
}

describe("Settings nesting", () => {
  test("Settings lists five rows", async () => {
    await openSettings();
    expect(view()).toBe("settings");
    expect(labels()).toEqual([
      "Remotes and Devices",
      "Library",
      "Sound output",
      "Apps",
      "Quit Couch",
    ]);
  });

  test("Remotes and Devices lists its items", async () => {
    const phone = await openSettings();
    await enter(phone, "Remotes and Devices");
    expect(view()).toBe("settingsRemotes");
    expect(labels()).toEqual(["Add a phone", "Forget all phones", "Start Couch Listener at login"]);
  });

  test("Library lists its items", async () => {
    const phone = await openSettings();
    await enter(phone, "Library");
    expect(view()).toBe("settingsLibrary");
    expect(labels()).toEqual(["Library folders", "Show and film details"]);
  });

  test("Sound output opens the Sound output page", async () => {
    const phone = await openSettings();
    await enter(phone, "Sound output");
    expect(view()).toBe("soundOutput");
    await phone.press("back");
    expect(view()).toBe("settings");
  });

  test("Apps lists each web App; YouTube has Restart and Add-ons", async () => {
    const phone = await openSettings();
    await enter(phone, "Apps");
    expect(view()).toBe("settingsApps");
    expect(labels()).toEqual(["YouTube", "Netflix"]);
    await phone.press("ok");
    expect(view()).toBe("settingsApp");
    expect(labels()).toEqual(["Restart YouTube", "Add-ons"]);
  });

  test("Back walks up one level at a time: add-ons → YouTube → Apps → Settings → Home", async () => {
    const phone = await openSettings();
    await enter(phone, "Apps");
    await phone.press("ok");
    await enter(phone, "Add-ons");
    expect(view()).toBe("addons");
    for (const expected of ["settingsApp", "settingsApps", "settings", "home"]) {
      await phone.press("back");
      expect(view()).toBe(expected);
    }
  });

  test("sub-pages go back to their group", async () => {
    const phone = await openSettings();
    await enter(phone, "Remotes and Devices");
    await enter(phone, "Add a phone");
    expect(view()).toBe("addPhone");
    await phone.press("back");
    expect(view()).toBe("settingsRemotes");
    await phone.press("back");
    expect(view()).toBe("settings");
    await enter(phone, "Library");
    await enter(phone, "Show and film details");
    expect(view()).toBe("details");
    await phone.press("back");
    expect(view()).toBe("settingsLibrary");
    await enter(phone, "Library folders");
    expect(view()).toBe("libraryFolders");
    await phone.press("back");
    expect(view()).toBe("settingsLibrary");
  });
});
