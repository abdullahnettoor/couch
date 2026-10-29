import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { APP_ENTRIES } from "./apps/index.ts";
import { HomeApps, leavesOnHide, resolveHomeApps } from "./core/home-apps.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { FileStore, MemoryStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";
import { homeAppSwitch } from "../shared/home-apps.ts";

let h: Harness;
const dirs: string[] = [];
afterEach(async () => {
  await h?.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const homeLabels = () =>
  h.screen.last.grid.filter((i) => i.id !== "settings" && i.r === 1).map((i) => i.label);
const view = () => h.screen.last.state.view;
const labels = () => h.screen.last.grid.map((i) => i.label);
const order = () => h.screen.last.homeApps?.map((a) => a.id);

async function focusLabel(phone: FakePhone, label: string) {
  const target = h.screen.last.grid.findIndex((i) => i.label === label);
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== label; i++) {
    const at = h.screen.last.grid.findIndex((g) => g.id === h.screen.last.focusedId);
    await phone.press(target > at ? "down" : "up");
  }
  expect(h.screen.last.focusedLabel).toBe(label);
}

async function openApps(phone: FakePhone) {
  await phone.press("up");
  await phone.press("ok");
  await focusLabel(phone, "Apps");
  await phone.press("ok");
  expect(view()).toBe("settingsApps");
}

/** Home → Settings → Apps, then OK on the App's row: the menu opens over the list. */
async function openMenu(phone: FakePhone, app: string) {
  await openApps(phone);
  await focusLabel(phone, app);
  await phone.press("ok");
  expect(view()).toBe("settingsApps");
  expect(h.screen.last.appMenu?.label).toBe(app);
}

async function pick(phone: FakePhone, label: string) {
  await focusLabel(phone, label);
  await phone.press("ok");
}

async function toHome(phone: FakePhone) {
  for (let i = 0; i < 4 && view() !== "home"; i++) await phone.press("back");
  expect(view()).toBe("home");
}

function tempStore(): FileStore {
  const dir = mkdtempSync(join(tmpdir(), "couch-home-apps-"));
  dirs.push(dir);
  return new FileStore(dir);
}

describe("Home Apps: choose and order", () => {
  test("Settings → Apps lists every App with its Show on Home switch, in Home order", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openApps(phone);
    expect(labels()).toEqual(["YouTube", "Netflix", "Library"]);
    expect(h.screen.last.appMenu).toBeUndefined();
    expect(h.screen.last.homeApps?.map((a) => [a.id, a.shown])).toEqual([
      ["youtube", true],
      ["netflix", true],
      ["library", true],
    ]);
    expect(h.screen.last.homeApps?.map((a) => homeAppSwitch(h.screen.last.homeApps, a.id))).toEqual(
      ["on", "on", "on"],
    );
  });

  test("OK on an App opens a menu over the list: Hide, Move up, Move down, Restart, Add-ons", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "YouTube");
    expect(labels()).toEqual([
      "Hide from Home",
      "Move up",
      "Move down",
      "Restart YouTube",
      "Add-ons",
    ]);
    expect(h.screen.last.homeApps).toHaveLength(3);
    await phone.press("back");
    await toHome(phone);
    await openMenu(phone, "Library");
    expect(labels()).toEqual(["Hide from Home", "Move up", "Move down"]);
  });

  test("hide, then show: the switch state, the menu label and Home follow; the menu stays open", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "Netflix");
    await pick(phone, "Hide from Home");
    expect(labels()[0]).toBe("Show on Home");
    expect(h.screen.last.appMenu?.id).toBe("netflix");
    expect(homeAppSwitch(h.screen.last.homeApps, "netflix")).toBe("off");
    expect(homeAppSwitch(h.screen.last.homeApps, "youtube")).toBe("on");
    await toHome(phone);
    expect(homeLabels()).toEqual(["YouTube", "Library"]);
    await openMenu(phone, "Netflix");
    await pick(phone, "Show on Home");
    expect(homeAppSwitch(h.screen.last.homeApps, "netflix")).toBe("on");
    await toHome(phone);
    expect(homeLabels()).toEqual(["YouTube", "Netflix", "Library"]);
  });

  test("Move up and Move down redraw the list at once, keep the menu open and the row marked", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "Library");
    await pick(phone, "Move up");
    expect(order()).toEqual(["youtube", "library", "netflix"]);
    expect(h.screen.last.appMenu?.id).toBe("library");
    expect(labels()[0]).toBe("Hide from Home");
    await pick(phone, "Move up");
    expect(order()).toEqual(["library", "youtube", "netflix"]);
    await pick(phone, "Move down");
    expect(order()).toEqual(["youtube", "library", "netflix"]);
    expect(h.screen.last.appMenu?.id).toBe("library");
    await phone.press("back");
    await toHome(phone);
    expect(homeLabels()).toEqual(["YouTube", "Library", "Netflix"]);
    const row = h.screen.last.grid.filter((i) => i.r === 1).map((i) => [i.label, i.c]);
    expect(row).toEqual([
      ["YouTube", 0],
      ["Library", 1],
      ["Netflix", 2],
    ]);
  });

  test("Move up on the first App and Move down on the last change nothing", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "YouTube");
    await pick(phone, "Move up");
    expect(order()).toEqual(["youtube", "netflix", "library"]);
    expect(h.screen.last.appMenu?.id).toBe("youtube");
    await phone.press("back");
    await focusLabel(phone, "Library");
    await phone.press("ok");
    await pick(phone, "Move down");
    expect(order()).toEqual(["youtube", "netflix", "library"]);
    expect(h.screen.last.appMenu?.id).toBe("library");
  });

  test("Back closes the menu with focus on that App's row, wherever Moves took it", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "Library");
    await pick(phone, "Move up");
    await pick(phone, "Move up");
    await phone.press("back");
    expect(view()).toBe("settingsApps");
    expect(h.screen.last.appMenu).toBeUndefined();
    expect(labels()).toEqual(["Library", "YouTube", "Netflix"]);
    expect(h.screen.last.focusedLabel).toBe("Library");
    await phone.press("back");
    expect(view()).toBe("settings");
  });

  test("Restart acts from the menu and leaves it open", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "Netflix");
    await pick(phone, "Restart Netflix");
    expect(h.screen.last.state.toast).toBe("Restarting Netflix");
    expect(h.screen.last.appMenu?.id).toBe("netflix");
  });

  test("order and hidden set survive a restart", async () => {
    const store = tempStore();
    h = await startHarness(store);
    let phone = await h.connectPhone();
    await openMenu(phone, "Library");
    await pick(phone, "Move up");
    await pick(phone, "Move up");
    await phone.press("back");
    await focusLabel(phone, "Netflix");
    await phone.press("ok");
    await pick(phone, "Hide from Home");
    expect(store.read("home.apps", null)).toEqual({
      order: ["library", "youtube", "netflix"],
      hidden: ["netflix"],
    });
    await h.stop();
    h = await startHarness(new FileStore(dirs[0]!));
    phone = await h.connectPhone();
    expect(homeLabels()).toEqual(["Library", "YouTube"]);
  });

  test("a new App is added at the end, shown; an unknown stored id is ignored", async () => {
    const store = tempStore();
    store.write("home.apps", { order: ["library", "gone", "youtube"], hidden: ["gone-too"] });
    h = await startHarness(store);
    await h.connectPhone();
    expect(homeLabels()).toEqual(["Library", "YouTube", "Netflix"]);
  });

  test("an App missing from the stored order is shown even if the stored hidden set names it", async () => {
    const store = tempStore();
    store.write("home.apps", { order: ["library", "youtube"], hidden: ["netflix", "youtube"] });
    h = await startHarness(store);
    await h.connectPhone();
    expect(homeLabels()).toEqual(["Library", "Netflix"]);
  });

  test("the last shown App can't be hidden", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "YouTube");
    await pick(phone, "Hide from Home");
    await phone.press("back");
    await focusLabel(phone, "Netflix");
    await phone.press("ok");
    await pick(phone, "Hide from Home");
    await phone.press("back");
    await focusLabel(phone, "Library");
    await phone.press("ok");
    await pick(phone, "Hide from Home");
    expect(h.screen.last.state.toast).toBe("Keep at least one App on Home");
    expect(labels()[0]).toBe("Hide from Home");
    await toHome(phone);
    expect(homeLabels()).toEqual(["Library"]);
  });

  test("a hidden App has no tile to open, and the others still open", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    await openMenu(phone, "Netflix");
    await pick(phone, "Hide from Home");
    await toHome(phone);
    expect(h.screen.last.grid.some((i) => i.id === "netflix")).toBe(false);
    await focusLabel(phone, "YouTube");
    await phone.press("ok");
    expect(view()).toBe("app");
    expect(h.screen.last.state.app).toBe("youtube");
  });

  test("Continue watching is hidden with the Library and back with it", async () => {
    const store = tempStore();
    const media = mkdtempSync(join(tmpdir(), "couch-home-media-"));
    dirs.push(media);
    const film = join(media, "A.Film.2001.mkv");
    mkdirSync(media, { recursive: true });
    writeFileSync(film, "");
    store.write("library", { folders: [media] });
    store.write("history", { items: { [film]: { position: 600, duration: 6000, at: 1 } } });
    h = await startHarness(store);
    const phone = await h.connectPhone();
    expect(h.screen.last.homeVideos?.map((v) => v.path)).toEqual([film]);
    expect(h.screen.last.continueCard?.path).toBe(film);
    await openMenu(phone, "Library");
    await pick(phone, "Hide from Home");
    expect(h.screen.last.homeVideos).toEqual([]);
    expect(h.screen.last.continueCard).toBeUndefined();
    await pick(phone, "Show on Home");
    expect(h.screen.last.homeVideos?.map((v) => v.path)).toEqual([film]);
  });

  test("an injected App has the same menu, with Restart, and goes through Home", async () => {
    const weather = new FakeWebApp("weather", "Weather", {});
    const entry = {
      id: "weather",
      label: "Weather",
      icon: "<svg>w</svg>",
      action: "app:open:weather",
      web: true,
    };
    h = await startHarness(undefined, { apps: [{ entry, app: weather }] });
    const phone = await h.connectPhone();
    expect(homeLabels()).toEqual(["YouTube", "Netflix", "Library", "Weather"]);
    await openMenu(phone, "Weather");
    expect(labels()).toEqual(["Hide from Home", "Move up", "Move down", "Restart Weather"]);
    expect(h.screen.last.homeApps?.find((a) => a.id === "weather")?.icon).toBe("<svg>w</svg>");
    await pick(phone, "Restart Weather");
    expect(weather.calls.map((c) => c.call)).toContain("restart");
    await pick(phone, "Hide from Home");
    await toHome(phone);
    expect(homeLabels()).toEqual(["YouTube", "Netflix", "Library"]);
  });
});

describe("resolveHomeApps (startup and Core)", () => {
  const catalog = APP_ENTRIES;

  test("all-hidden storage resolves to one shown App", () => {
    const store = new MemoryStore();
    store.write("home.apps", {
      order: ["netflix", "youtube", "library"],
      hidden: ["netflix", "youtube", "library"],
    });
    const rows = resolveHomeApps(store, catalog);
    expect(rows.filter((r) => r.shown).map((r) => r.id)).toEqual(["netflix"]);
  });

  test("Core's Home agrees with the resolver on all-hidden storage", async () => {
    const store = tempStore();
    store.write("home.apps", {
      order: ["netflix", "youtube", "library"],
      hidden: ["youtube", "netflix", "library"],
    });
    h = await startHarness(store);
    await h.connectPhone();
    expect(homeLabels()).toEqual(
      resolveHomeApps(store, catalog)
        .filter((r) => r.shown)
        .map((r) => r.label),
    );
    expect(homeLabels()).toEqual(["Netflix"]);
  });

  test("an id missing from the stored order is appended and shown, even if stored hidden", () => {
    const store = new MemoryStore();
    store.write("home.apps", { order: ["library"], hidden: ["youtube"] });
    expect(resolveHomeApps(store, catalog).map((r) => [r.id, r.shown])).toEqual([
      ["library", true],
      ["youtube", true],
      ["netflix", true],
    ]);
  });

  test("an empty or damaged document gives the default order, all shown", () => {
    const store = new MemoryStore();
    store.write("home.apps", { order: "x", hidden: 3 });
    expect(resolveHomeApps(store, catalog).map((r) => [r.id, r.shown])).toEqual([
      ["youtube", true],
      ["netflix", true],
      ["library", true],
    ]);
  });
});

describe("HomeApps module boundary", () => {
  function make(stored?: unknown) {
    const store = new MemoryStore();
    if (stored) store.write("home.apps", stored);
    const log: string[] = [];
    const apps = new HomeApps({
      store,
      known: () => APP_ENTRIES,
      toast: (t) => log.push(`toast:${t}`),
      hidden: (id) => log.push(`hidden:${id}`),
      changed: () => log.push("changed"),
      hasSignIn: () => false,
      hasCouchCopy: () => false,
    });
    return { apps, log, store };
  }

  test("hiding an App tells the host so it can leave it first", () => {
    const { apps, log } = make();
    expect(apps.setShown("youtube", false)).toBe(true);
    expect(log).toContain("hidden:youtube");
    expect(apps.isShown("youtube")).toBe(false);
  });

  test("hiding the last shown App is refused with a toast and no hidden call", () => {
    const { apps, log } = make({
      order: ["youtube", "netflix", "library"],
      hidden: ["netflix", "library"],
    });
    expect(apps.setShown("youtube", false)).toBe(false);
    expect(log).toEqual(["toast:Keep at least one App on Home"]);
  });

  test("a hidden App isn't shown, so core can't open it; an unknown id isn't shown either", () => {
    const { apps } = make({ order: ["youtube", "netflix", "library"], hidden: ["netflix"] });
    expect(apps.isShown("netflix")).toBe(false);
    expect(apps.isShown("nope")).toBe(false);
    expect(apps.shownIds()).toEqual(["youtube", "library"]);
  });

  test("moving past either end does nothing", () => {
    const { apps, log } = make();
    apps.openMenu("youtube");
    log.length = 0;
    apps.move("youtube", -1);
    apps.move("library", 1);
    expect(apps.rows().map((r) => r.id)).toEqual(["youtube", "netflix", "library"]);
    expect(log).toEqual([]);
  });

  test("the Library owns its views, a web App only its own, so hiding the Library leaves them", () => {
    for (const v of [
      "library",
      "folder",
      "libraryFolders",
      "librarySearch",
      "show",
      "fixMatch",
      "player",
    ] as const)
      expect(leavesOnHide("library", v, undefined)).toBe(true);
    expect(leavesOnHide("library", "home", undefined)).toBe(false);
    expect(leavesOnHide("library", "settingsApps", undefined)).toBe(false);
    expect(leavesOnHide("netflix", "app", "netflix")).toBe(true);
    expect(leavesOnHide("netflix", "app", "youtube")).toBe(false);
    expect(leavesOnHide("netflix", "player", undefined)).toBe(false);
  });
});

describe("Show on Home switch", () => {
  test("is on, off, or absent for an id Home doesn't know", () => {
    const rows = [
      { id: "a", label: "A", icon: "", shown: true },
      { id: "b", label: "B", icon: "", shown: false },
    ];
    expect(homeAppSwitch(rows, "a")).toBe("on");
    expect(homeAppSwitch(rows, "b")).toBe("off");
    expect(homeAppSwitch(rows, "c")).toBeUndefined();
    expect(homeAppSwitch(undefined, "a")).toBeUndefined();
  });
});
