import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";
import { FakeWebApp } from "./ports/fakes.ts";

let h: Harness;
const dirs: string[] = [];
afterEach(async () => {
  await h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const homeLabels = () =>
  h.screen.last.grid.filter((i) => i.id !== "settings" && i.r === 1).map((i) => i.label);
const view = () => h.screen.last.state.view;
const labels = () => h.screen.last.grid.map((i) => i.label);

async function focusLabel(phone: FakePhone, label: string) {
  const target = h.screen.last.grid.findIndex((i) => i.label === label);
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== label; i++) {
    const at = h.screen.last.grid.findIndex((g) => g.id === h.screen.last.focusedId);
    await phone.press(target > at ? "down" : "up");
  }
  expect(h.screen.last.focusedLabel).toBe(label);
}

/** Home → Settings → Apps, then OK on the App's row. */
async function openAppPage(phone: FakePhone, app: string) {
  await phone.press("up");
  await phone.press("ok");
  await focusLabel(phone, "Apps");
  await phone.press("ok");
  await focusLabel(phone, app);
  await phone.press("ok");
  expect(view()).toBe("settingsApp");
}

async function pick(phone: FakePhone, label: string) {
  await focusLabel(phone, label);
  await phone.press("ok");
}

async function toHome(phone: FakePhone) {
  for (let i = 0; i < 4 && view() !== "home"; i++) await phone.press("back");
  expect(view()).toBe("home");
}

describe("Home Apps: choose and order", () => {
  test("Settings → Apps lists every App with its Home state, in Home order", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await phone.press("up");
    await phone.press("ok");
    await focusLabel(phone, "Apps");
    await phone.press("ok");
    expect(view()).toBe("settingsApps");
    expect(labels()).toEqual(["YouTube", "Netflix", "Library"]);
    expect(h.screen.last.homeApps).toEqual([
      { id: "youtube", label: "YouTube", shown: true },
      { id: "netflix", label: "Netflix", shown: true },
      { id: "library", label: "Library", shown: true },
    ]);
  });

  test("an App's page offers Hide, Move left, Move right, then Restart and Add-ons", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openAppPage(phone, "YouTube");
    expect(labels()).toEqual([
      "Hide from Home",
      "Move left",
      "Move right",
      "Restart YouTube",
      "Add-ons",
    ]);
    await toHome(phone);
    await openAppPage(phone, "Library");
    expect(labels()).toEqual(["Hide from Home", "Move left", "Move right"]);
  });

  test("hide, then show: Home follows and the page's label flips", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openAppPage(phone, "Netflix");
    await pick(phone, "Hide from Home");
    expect(labels()[0]).toBe("Show on Home");
    expect(h.screen.last.homeApps?.find((a) => a.id === "netflix")?.shown).toBe(false);
    await toHome(phone);
    expect(homeLabels()).toEqual(["YouTube", "Library"]);
    await openAppPage(phone, "Netflix");
    await pick(phone, "Show on Home");
    await toHome(phone);
    expect(homeLabels()).toEqual(["YouTube", "Netflix", "Library"]);
  });

  test("Move left and Move right shift one place and Home's grid follows", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openAppPage(phone, "Library");
    await pick(phone, "Move left");
    expect(h.screen.last.homeApps?.map((a) => a.id)).toEqual(["youtube", "library", "netflix"]);
    await pick(phone, "Move left");
    await pick(phone, "Move left");
    expect(h.screen.last.homeApps?.map((a) => a.id)).toEqual(["library", "youtube", "netflix"]);
    await pick(phone, "Move right");
    await toHome(phone);
    expect(homeLabels()).toEqual(["YouTube", "Library", "Netflix"]);
    const row = h.screen.last.grid.filter((i) => i.r === 1).map((i) => [i.label, i.c]);
    expect(row).toEqual([
      ["YouTube", 0],
      ["Library", 1],
      ["Netflix", 2],
    ]);
  });

  test("order and hidden set survive a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "couch-home-apps-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    h = await startHarness(store);
    let phone = await h.connectPhone();
    await openAppPage(phone, "Library");
    await pick(phone, "Move left");
    await pick(phone, "Move left");
    await toHome(phone);
    await openAppPage(phone, "Netflix");
    await pick(phone, "Hide from Home");
    expect(store.read("home.apps", null)).toEqual({
      order: ["library", "youtube", "netflix"],
      hidden: ["netflix"],
    });
    await h.stop();
    h = await startHarness(new FileStore(dir));
    phone = await h.connectPhone();
    expect(homeLabels()).toEqual(["Library", "YouTube"]);
  });

  test("a new App is added at the end, shown; an unknown stored id is ignored", async () => {
    const dir = mkdtempSync(join(tmpdir(), "couch-home-apps-"));
    dirs.push(dir);
    const store = new FileStore(dir);
    store.write("home.apps", { order: ["library", "gone", "youtube"], hidden: ["gone-too"] });
    h = await startHarness(store);
    await h.connectPhone();
    expect(homeLabels()).toEqual(["Library", "YouTube", "Netflix"]);
  });

  test("the last shown App can't be hidden", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openAppPage(phone, "YouTube");
    await pick(phone, "Hide from Home");
    await toHome(phone);
    await openAppPage(phone, "Netflix");
    await pick(phone, "Hide from Home");
    await toHome(phone);
    await openAppPage(phone, "Library");
    await pick(phone, "Hide from Home");
    expect(h.screen.last.state.toast).toBe("Keep at least one App on Home");
    expect(labels()[0]).toBe("Hide from Home");
    await toHome(phone);
    expect(homeLabels()).toEqual(["Library"]);
  });

  test("a hidden App can't be opened", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openAppPage(phone, "Netflix");
    await pick(phone, "Hide from Home");
    await toHome(phone);
    h.app.core.openApp("netflix");
    expect(view()).toBe("home");
  });

  test("hiding the open App goes Home first", async () => {
    h = await startHarness();
    await h.connectPhone();
    h.app.core.openApp("youtube");
    expect(view()).toBe("app");
    h.app.core.setAppShown("youtube", false);
    expect(view()).toBe("home");
    expect(homeLabels()).toEqual(["Netflix", "Library"]);
  });

  test("a hidden App stays out of Home but keeps working when shown again", async () => {
    const weather = new FakeWebApp("weather", "Weather", {});
    const entry = {
      id: "weather",
      label: "Weather",
      icon: "<svg></svg>",
      action: "app:open:weather",
      web: true,
    };
    h = await startHarness(undefined, { apps: [{ entry, app: weather }] });
    await h.connectPhone();
    expect(homeLabels()).toEqual(["YouTube", "Netflix", "Library", "Weather"]);
    h.app.core.setAppShown("weather", false);
    expect(homeLabels()).toEqual(["YouTube", "Netflix", "Library"]);
    h.app.core.setAppShown("weather", true);
    expect(homeLabels()).toEqual(["YouTube", "Netflix", "Library", "Weather"]);
  });

  test("Continue watching is hidden with the Library and back with it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "couch-home-apps-"));
    const media = mkdtempSync(join(tmpdir(), "couch-home-media-"));
    dirs.push(dir, media);
    const film = join(media, "A.Film.2001.mkv");
    mkdirSync(media, { recursive: true });
    writeFileSync(film, "");
    const store = new FileStore(dir);
    store.write("library", { folders: [media] });
    store.write("history", { items: { [film]: { position: 600, duration: 6000, at: 1 } } });
    h = await startHarness(store);
    await h.connectPhone();
    expect(h.screen.last.homeVideos?.map((v) => v.path)).toEqual([film]);
    expect(h.screen.last.continueCard?.path).toBe(film);
    h.app.core.setAppShown("library", false);
    expect(h.screen.last.homeVideos).toEqual([]);
    expect(h.screen.last.continueCard).toBeUndefined();
    expect(h.screen.last.grid.some((i) => i.id === film)).toBe(false);
    h.app.core.setAppShown("library", true);
    expect(h.screen.last.homeVideos?.map((v) => v.path)).toEqual([film]);
  });
});
