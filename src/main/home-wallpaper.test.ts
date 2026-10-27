import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let storeDir: string;
let store: FileStore;
let h: Harness;
let phone: FakePhone;
beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "couch-wallpaper-"));
  store = new FileStore(storeDir);
});
afterEach(async () => {
  await h?.stop();
  rmSync(storeDir, { recursive: true, force: true });
});

const view = () => h.screen.last.state.view;
const wallpaper = () => h.screen.last.home?.wallpaper;
const start = async () => {
  h = await startHarness(store);
  phone = await h.connectPhone();
};

async function openHomePage() {
  await phone.press("up");
  await phone.press("ok");
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== "Home"; i++) await phone.press("down");
  await phone.press("ok");
  expect(view()).toBe("settingsHome");
}

describe("Home wallpaper", () => {
  test("Couch is the default, with artwork on", async () => {
    await start();
    expect(h.screen.last.home).toEqual({
      wallpaper: { kind: "builtin", id: "couch" },
      artwork: true,
    });
  });

  test("the page lists six tiles and the artwork switch, focus on the chosen tile", async () => {
    store.write("home", { wallpaper: { kind: "builtin", id: "forest" } });
    await start();
    await openHomePage();
    expect(h.screen.last.grid.map((g) => g.label)).toEqual([
      "Couch",
      "Dusk",
      "Ocean",
      "Forest",
      "Ember",
      "Graphite",
      "Show artwork behind Resume",
    ]);
    expect(h.screen.last.focusedLabel).toBe("Forest");
  });

  test("OK chooses a wallpaper: the payload changes, it is stored and survives a restart", async () => {
    await start();
    await openHomePage();
    await phone.press("right");
    await phone.press("ok");
    expect(wallpaper()).toEqual({ kind: "builtin", id: "dusk" });
    expect(store.read<{ wallpaper: unknown }>("home", { wallpaper: null }).wallpaper).toEqual({
      kind: "builtin",
      id: "dusk",
    });
    await h.stop();
    await start();
    expect(wallpaper()).toEqual({ kind: "builtin", id: "dusk" });
  });

  test("an unknown stored id falls back to Couch", async () => {
    store.write("home", { wallpaper: { kind: "builtin", id: "sunrise" }, artwork: "maybe" });
    await start();
    expect(wallpaper()).toEqual({ kind: "builtin", id: "couch" });
    expect(h.screen.last.home?.artwork).toBe(true);
  });

  test("moving along the tiles previews live; Back keeps the last choice", async () => {
    await start();
    await openHomePage();
    await phone.press("right");
    await phone.press("right");
    expect(wallpaper()?.id).toBe("ocean");
    expect(store.read("home", {})).toEqual({});
    await phone.press("back");
    expect(view()).toBe("settings");
    expect(wallpaper()?.id).toBe("couch");
  });

  test("Back after choosing keeps the choice", async () => {
    await start();
    await openHomePage();
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("right");
    expect(wallpaper()?.id).toBe("forest");
    await phone.press("back");
    expect(wallpaper()?.id).toBe("ocean");
  });

  test("the artwork switch is stored and survives a restart", async () => {
    await start();
    await openHomePage();
    await phone.press("down");
    expect(h.screen.last.focusedLabel).toBe("Show artwork behind Resume");
    await phone.press("ok");
    expect(h.screen.last.home?.artwork).toBe(false);
    await h.stop();
    await start();
    expect(h.screen.last.home?.artwork).toBe(false);
    await openHomePage();
    await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.home?.artwork).toBe(true);
  });

  test("artwork off leaves the hero and its text in place for the renderer to skip the art", async () => {
    const root = mkdtempSync(join(tmpdir(), "couch-wallpaper-lib-"));
    try {
      mkdirSync(join(root, "Films"));
      const film = join(root, "Films", "A.Film.2001.mkv");
      writeFileSync(film, "");
      store.write("library", { folders: [root] });
      store.write("home", { artwork: false });
      await start();
      for (const id of ["library", root, join(root, "Films"), film]) {
        for (let i = 0; i < 20 && h.app.screen().focusedId !== id; i++) {
          const s = h.app.screen();
          const cur = s.grid.find((x) => x.id === s.focusedId)!;
          const t = s.grid.find((x) => x.id === id)!;
          h.app.screenCommand({
            command: t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left",
          });
        }
        h.app.screenCommand({ command: "ok" });
      }
      h.player.emit({ type: "duration", seconds: 7200 });
      h.player.emit({ type: "position", seconds: 600 });
      h.app.screenCommand({ command: "home" });
      for (let i = 0; i < 3; i++) h.app.screenCommand({ command: "right" });
      expect(h.app.screen().hero?.path).toBe(film);
      expect(h.app.screen().home?.artwork).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
