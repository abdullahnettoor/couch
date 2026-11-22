import { afterEach, describe, expect, test } from "vite-plus/test";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";
import { homeAppSwitch } from "../shared/home-apps.ts";
import { quickSettingsPage } from "../shared/quick-settings-page.ts";

let h: Harness;
afterEach(() => h.stop());

const entry = (id: string, label: string) => ({
  id,
  label,
  icon: "<svg></svg>",
  action: `app:open:${id}`,
  web: true,
});
const settle = () => new Promise((r) => setTimeout(r, 30));
const quick = () => h.screen.last.quick;
const sizes = (app: FakeWebApp) =>
  app.calls.filter((c) => c.call === "setTextSize").map((c) => c.args[0]);

async function start(given?: Harness["store"]) {
  const big = new FakeWebApp("big", "Big", { textSize: true });
  const plain = new FakeWebApp("plain", "Plain");
  const wide = new FakeWebApp("wide", "Wide", { textSize: true });
  h = await startHarness(given, {
    apps: [
      { entry: entry("big", "Big"), app: big },
      { entry: entry("plain", "Plain"), app: plain },
      { entry: entry("wide", "Wide"), app: wide },
    ],
  });
  const phone = await h.connectPhone();
  await settle();
  return { big, plain, wide, phone };
}

async function openApp(phone: FakePhone, id: string) {
  for (let i = 0; i < 30 && h.screen.last.focusedId !== id; i++) await phone.press("right");
  await phone.press("ok");
  expect(h.screen.last.state.app).toBe(id);
}
const drawer = async (phone: FakePhone) => {
  await phone.press("quickSettings");
  await settle();
};
const toRow = async (phone: FakePhone, id: string) => {
  for (let i = 0; i < 10 && quick()?.focusedId !== id; i++) await phone.press("down");
  expect(quick()?.focusedId).toBe(id);
};
const ids = () => quick()!.items.map((i) => i.id);

describe("Text size in Quick settings", () => {
  test("the row shows only over an App that supports Text size", async () => {
    const { phone } = await start();
    await drawer(phone);
    expect(ids()).not.toContain("textsize");
    expect(quick()?.textSize).toBeUndefined();
    await phone.press("quickSettings");
    await openApp(phone, "plain");
    await drawer(phone);
    expect(ids()).not.toContain("textsize");
    await phone.press("quickSettings");
    await phone.press("home");
    await openApp(phone, "big");
    await drawer(phone);
    expect(ids().indexOf("textsize")).toBe(ids().indexOf("vol") + 1);
    expect(quick()?.textSize).toBe("Default");
    const rows = quick()!.items;
    expect(rows.map((i) => i.r)).toEqual(rows.map((_, i) => i));
  });

  test("each App keeps its own size: one's change leaves the other's", async () => {
    const { big, wide, phone } = await start();
    await openApp(phone, "big");
    await drawer(phone);
    await toRow(phone, "textsize");
    await phone.press("right");
    await phone.press("quickSettings");
    await phone.press("home");
    await openApp(phone, "wide");
    await drawer(phone);
    expect(quick()?.textSize).toBe("Default");
    await toRow(phone, "textsize");
    await phone.press("left");
    expect(quick()?.textSize).toBe("Smaller");
    expect(sizes(big).at(-1)).toBe("larger");
    expect(sizes(wide).at(-1)).toBe("smaller");
    await phone.press("quickSettings");
    await phone.press("home");
    await openApp(phone, "big");
    await drawer(phone);
    expect(quick()?.textSize).toBe("Larger");
  });

  test("never over YouTube", async () => {
    const { phone } = await start();
    await openApp(phone, "youtube");
    await drawer(phone);
    expect(ids()).not.toContain("textsize");
  });

  test("Left and Right step that App's size live without closing the drawer", async () => {
    const { big, plain, phone } = await start();
    await openApp(phone, "big");
    big.calls.length = 0;
    await drawer(phone);
    await toRow(phone, "textsize");
    await phone.press("right");
    expect(quick()?.textSize).toBe("Larger");
    expect(sizes(big)).toEqual(["larger"]);
    await phone.press("right");
    expect(quick()).toBeDefined();
    expect(quick()?.textSize).toBe("Larger");
    await phone.press("left");
    await phone.press("left");
    expect(quick()?.textSize).toBe("Smaller");
    expect(sizes(big)).toEqual(["larger", "default", "smaller"]);
    expect(sizes(plain)).toEqual([]);
  });

  test("a click on the row's buttons does the same", async () => {
    const { big, phone } = await start();
    await openApp(phone, "big");
    await drawer(phone);
    h.app.screenCommand({ command: "quickPick", args: { item: "ts:up" } });
    await settle();
    expect(quick()?.textSize).toBe("Larger");
    expect(sizes(big).at(-1)).toBe("larger");
  });

  test("the page draws the row's value and buttons", () => {
    const page = quickSettingsPage();
    expect(page).toContain("ts:down");
    expect(page).toContain("q.textSize");
  });
});

describe("Text size in Settings", () => {
  const go = async (phone: FakePhone, label: string) => {
    const target = h.screen.last.grid.findIndex((i) => i.label === label || i.id === label);
    for (let i = 0; i < 20 && h.screen.last.focusedId !== h.screen.last.grid[target]?.id; i++) {
      const at = h.screen.last.grid.findIndex((g) => g.id === h.screen.last.focusedId);
      await phone.press(target > at ? "down" : "up");
    }
    expect(h.screen.last.focusedId).toBe(h.screen.last.grid[target]?.id);
  };
  const toApps = async (phone: FakePhone) => {
    await phone.press("up");
    await phone.press("ok");
    await go(phone, "Apps");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settingsApps");
  };
  const label = () => h.screen.last.grid.find((i) => i.id === "text-size")?.label ?? "";

  test("the Apps list sets the default for every App and clears App choices", async () => {
    const { big, phone } = await start();
    await openApp(phone, "big");
    await drawer(phone);
    await toRow(phone, "textsize");
    await phone.press("left");
    await phone.press("quickSettings");
    expect(sizes(big).at(-1)).toBe("smaller");
    await phone.press("home");
    await toApps(phone);
    expect(label()).toBe("Text size: Default");
    await go(phone, "text-size");
    await phone.press("ok");
    expect(label()).toBe("Text size: Larger");
    expect(sizes(big).at(-1)).toBe("larger");
    await go(phone, "Big");
    await phone.press("ok");
    expect(label()).toBe("Text size: Larger");
  });

  test("the Library has no Text size row", async () => {
    const { phone } = await start();
    await phone.press("up");
    await phone.press("ok");
    await go(phone, "Library");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settingsLibrary");
    expect(h.screen.last.grid.some((i) => i.id === "text-size")).toBe(false);
  });

  test("the default clears App choices in the stored document and survives a restart", async () => {
    const { phone } = await start();
    await openApp(phone, "big");
    await drawer(phone);
    await toRow(phone, "textsize");
    await phone.press("left");
    await phone.press("quickSettings");
    await phone.press("home");
    expect(h.store.read<{ apps?: object }>("text-size", {}).apps).toEqual({ big: "smaller" });
    await toApps(phone);
    await go(phone, "text-size");
    await phone.press("ok");
    expect(h.store.read("text-size", {})).toEqual({ default: "larger", apps: {} });
    const store = h.store;
    await h.app.stop();
    const { big, wide } = await start(store);
    expect(sizes(big)).toEqual(["larger"]);
    expect(sizes(wide)).toEqual(["larger"]);
  });

  test("an App that is hidden from Home still gets the default", async () => {
    const { big, phone } = await start();
    await toApps(phone);
    await go(phone, "Big");
    await phone.press("ok");
    await go(phone, "Hide from Home");
    await phone.press("ok");
    await phone.press("back");
    expect(homeAppSwitch(h.screen.last.homeApps, "big")).toBe("off");
    await go(phone, "text-size");
    await phone.press("ok");
    expect(sizes(big).at(-1)).toBe("larger");
  });

  test("a default changed while an App can't apply it still reaches it when it can again", async () => {
    const { big, phone } = await start();
    big.supportsTextSize = false;
    await toApps(phone);
    await go(phone, "text-size");
    await phone.press("ok");
    expect(sizes(big).at(-1)).toBe("larger");
    big.supportsTextSize = true;
    await phone.press("home");
    await openApp(phone, "big");
    await drawer(phone);
    expect(quick()?.textSize).toBe("Larger");
  });

  test("an App's menu has its own row, only for an App that supports it, and agrees with Quick settings", async () => {
    const { big, phone } = await start();
    await toApps(phone);
    await go(phone, "Plain");
    await phone.press("ok");
    expect(h.screen.last.grid.some((i) => i.id === "text-size")).toBe(false);
    await phone.press("back");
    await go(phone, "Big");
    await phone.press("ok");
    const rows = h.screen.last.grid;
    expect(rows.map((i) => i.r)).toEqual(rows.map((_, i) => i));
    expect(label()).toBe("Text size: Default");
    await go(phone, "text-size");
    await phone.press("ok");
    expect(label()).toBe("Text size: Larger");
    expect(sizes(big).at(-1)).toBe("larger");
    await phone.press("home");
    await openApp(phone, "big");
    await drawer(phone);
    expect(quick()?.textSize).toBe("Larger");
  });

  test("the choice survives a restart, and each App is told at startup", async () => {
    const { phone } = await start();
    await openApp(phone, "big");
    await drawer(phone);
    await toRow(phone, "textsize");
    await phone.press("left");
    const store = h.store;
    await phone.press("quickSettings");
    await h.app.stop();
    const { big } = await start(store);
    expect(sizes(big)).toEqual(["smaller"]);
  });
});
