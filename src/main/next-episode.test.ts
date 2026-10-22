import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { focusFolders, startHarness, type Harness, type FakePhone } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let store: FileStore;
let h: Harness;
let phone: FakePhone;
const ep = (n: number) => join(root, "Show", `Show S01E0${n}.mkv`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-next-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-nextstore-"));
  mkdirSync(join(root, "Show"), { recursive: true });
  for (const n of [1, 2, 3]) writeFileSync(ep(n), "");
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const calls = (name: string) => h.player.calls.filter((c) => c.call === name);
const loads = () => calls("load").map((c) => c.args[0]);
const state = () => h.screen.last.state;
const overlay = () => h.screen.last.overlay!;

/** Library → Show → plays episode `n` (1-based; Show is the only folder). */
async function playEp(n: number) {
  store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store);
  phone = await h.connectPhone();
  await phone.press("right");
  await phone.press("right");
  await phone.press("ok");
  await focusFolders(h, phone);
  await phone.press("ok");
  await phone.press("ok"); // Show
  for (let i = 1; i < n; i++) await phone.press("right");
  await phone.press("ok");
  h.player.emit({ type: "duration", seconds: 600 });
}

const eof = () => h.player.emit({ type: "ended", reason: "eof" });

describe("Play next episode", () => {
  test("the end of a file with a next video shows the card, focused on Play", async () => {
    await playEp(1);
    eof();
    expect(state().view).toBe("player");
    expect(state().controls).toBe("next");
    expect(overlay().next).toMatchObject({ focusedId: "playnext" });
    expect(overlay().next!.title).toBe("Episode 2");
    expect(overlay().next!.line).toContain("S1 E2");
    expect(overlay().dock).toBeUndefined();
    const snap = await phone.press("volUp");
    expect(snap.next!.title).toBe("Episode 2");
  });

  test("OK plays the next path, and the first video is marked watched in the folder", async () => {
    await playEp(1);
    eof();
    await phone.press("ok");
    expect(loads().at(-1)).toBe(ep(2));
    expect(state().view).toBe("player");
    expect(state().controls).toBe("dock");
    expect(overlay().next).toBeUndefined();
    await phone.press("back"); // stops the second video, back in the folder
    expect(h.screen.last.library!.entries.find((e) => e.path === ep(1))!.watched).toBe(true);
  });

  test("the phone's playNext plays it; Back afterwards still returns to the folder", async () => {
    await playEp(1);
    eof();
    await phone.press("playNext");
    expect(loads().at(-1)).toBe(ep(2));
    await phone.press("back");
    await phone.press("back");
    expect(state().view).toBe("folder");
  });

  test("Back returns to where the video was started, without playing, focused on the next video", async () => {
    await playEp(1);
    eof();
    await phone.press("back");
    expect(loads()).toEqual([ep(1)]);
    expect(state().view).toBe("folder");
    expect(h.screen.last.focusedId).toBe(ep(2));
  });

  test("Back to folder button leaves too", async () => {
    await playEp(1);
    eof();
    await phone.press("right");
    expect(overlay().next!.focusedId).toBe("backfolder");
    await phone.press("ok");
    expect(loads()).toEqual([ep(1)]);
    expect(state().view).toBe("folder");
  });

  test("Home always means Home, even from the card", async () => {
    await playEp(1);
    eof();
    await phone.press("home");
    expect(state().view).toBe("home");
    expect(loads()).toEqual([ep(1)]);
  });

  test("15 s with no input returns to where the video was started, without playing", async () => {
    await playEp(1);
    eof();
    h.clock.advance(14_000);
    expect(state().controls).toBe("next");
    h.clock.advance(1_500);
    expect(state().view).toBe("folder");
    expect(loads()).toEqual([ep(1)]);
  });

  test("the 15 s count restarts on any input: navigation, volume and mouse focus", async () => {
    await playEp(1);
    eof();
    h.clock.advance(10_000);
    await phone.press("right");
    h.clock.advance(10_000);
    expect(state().controls).toBe("next");
    await phone.press("volUp");
    h.clock.advance(10_000);
    expect(state().controls).toBe("next");
    h.app.screenCommand({ command: "focusAt", args: { r: 0, c: 0 } });
    h.clock.advance(10_000);
    expect(state().controls).toBe("next");
    h.clock.advance(6_000);
    expect(state().view).toBe("folder");
    expect(loads()).toEqual([ep(1)]);
  });

  test("volume commands, including volSet, work while the card shows", async () => {
    await playEp(1);
    eof();
    await phone.press({ command: "volSet", args: { percent: 33 } });
    expect(h.player.calls.at(-1)).toEqual({ call: "setVolume", args: [33] });
    expect(state().controls).toBe("next");
  });

  test("the last video in a folder leaves straight away", async () => {
    await playEp(3);
    eof();
    expect(state().view).toBe("folder");
    expect(calls("load")).toHaveLength(1);
  });

  test("playNext is refused when there is no card", async () => {
    await playEp(1);
    await phone.press("playNext");
    expect(calls("load")).toHaveLength(1);
    expect(state().controls).not.toBe("next");
  });
});

describe("Show order", () => {
  let a: string[];
  async function playArcane(n: number) {
    rmSync(join(root, "Show"), { recursive: true, force: true });
    const s1 = join(root, "Arcane", "Season 1");
    const s2 = join(root, "Arcane", "Season 2");
    mkdirSync(s1, { recursive: true });
    mkdirSync(s2, { recursive: true });
    a = [
      join(s1, "Arcane S01E01.mkv"),
      join(s1, "Arcane S01E02.mkv"),
      join(s2, "Arcane S02E01.mkv"),
    ];
    for (const f of a) writeFileSync(f, "");
    store = new FileStore(storeDir);
    store.write("library", { folders: [root] });
    h = await startHarness(store);
    phone = await h.connectPhone();
    await h.app.core.library.refresh([root]);
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok");
    await focusFolders(h, phone);
    await phone.press("ok");
    await phone.press("ok"); // Arcane
    await phone.press("ok"); // Season 1
    for (let i = 1; i < n; i++) await phone.press("right");
    await phone.press("ok");
    h.player.emit({ type: "duration", seconds: 600 });
  }

  test("Up next lists the whole show in order, playing marked; indices match", async () => {
    await playArcane(1);
    await phone.press("down");
    await phone.press("down");
    const tiles = overlay().upNext!.tiles;
    expect(tiles.map((t) => [t.line, t.playing])).toEqual([
      ["Arcane · S1 E1", true],
      ["Arcane · S1 E2", false],
      ["Arcane · S2 E1", false],
    ]);
    expect(overlay().upNext!.folder).toBe("Arcane");
    await phone.press({ command: "playUpNext", args: { index: 2 } });
    expect(loads().at(-1)).toBe(a[2]);
  });

  test("Play next at the end of S1 offers S2E1; the last episode leaves", async () => {
    await playArcane(2);
    eof();
    expect(state().controls).toBe("next");
    expect(overlay().next!.line).toContain("S2 E1");
    await phone.press("ok");
    expect(loads().at(-1)).toBe(a[2]);
    eof();
    expect(state().controls).not.toBe("next");
    expect(state().view).not.toBe("player");
  });
});
