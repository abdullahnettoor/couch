import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
const dirs: string[] = [];
afterEach(async () => {
  await h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function start(store?: FileStore) {
  h = await startHarness(store);
  return h.connectPhone();
}

async function focus(phone: FakePhone, label: string) {
  for (let i = 0; i < 20 && h.screen.last.focusedLabel !== label; i++) await phone.press("down");
  expect(h.screen.last.focusedLabel).toBe(label);
}

async function openAddons(phone: FakePhone) {
  await phone.press("up");
  await phone.press("ok");
  await focus(phone, "YouTube add-ons");
  await phone.press("ok");
}

const setCalls = () => h.youtube.calls.filter((c) => c.call === "setAddons");

describe("YouTube add-ons in Settings", () => {
  test("the item sits under Restart YouTube and shows how many are on", async () => {
    const phone = await start();
    await phone.press("up");
    await phone.press("ok");
    const labels = h.screen.last.grid.map((i) => i.label);
    expect(labels.indexOf("YouTube add-ons")).toBe(labels.indexOf("Restart YouTube") + 1);
    expect(h.screen.last.addons?.filter((a) => a.on)).toHaveLength(1);
  });

  test("the sub-page lists each add-on with its default and description", async () => {
    const phone = await start();
    await openAddons(phone);
    expect(h.screen.last.state.view).toBe("addons");
    expect(h.screen.last.addons).toEqual([
      expect.objectContaining({ id: "4k", label: "4K video", on: true }),
    ]);
    expect(h.screen.last.addons![0].description).not.toBe("");
    expect(h.screen.last.grid.map((i) => i.id)).toEqual(["4k"]);
    expect(setCalls()).toHaveLength(0);
  });

  test("OK toggles: the Store keeps the choice and YouTube reloads with the new set", async () => {
    const phone = await start();
    await openAddons(phone);
    await phone.press("ok");
    expect(h.store.read("addons", {})).toEqual({ youtube: { "4k": false } });
    expect(setCalls().at(-1)?.args[0]).toEqual([]);
    expect(h.screen.last.addons![0].on).toBe(false);
    expect(h.screen.last.state.toast).toBe("4K video is off");
    await phone.press("ok");
    expect(h.store.read("addons", {})).toEqual({ youtube: {} });
    expect(setCalls().at(-1)?.args[0]).toEqual(["4k"]);
    expect(h.screen.last.state.toast).toBe("4K video is on");
  });

  test("Back returns to Settings", async () => {
    const phone = await start();
    await openAddons(phone);
    expect((await phone.press("back")).view).toBe("settings");
  });

  test("choices survive a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "couch-addons-"));
    dirs.push(dir);
    let phone = await start(new FileStore(dir));
    await openAddons(phone);
    await phone.press("ok");
    await h.stop();
    phone = await start(new FileStore(dir));
    await openAddons(phone);
    expect(h.screen.last.addons![0].on).toBe(false);
  });
});
