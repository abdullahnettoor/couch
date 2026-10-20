import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;

const at = (...parts: string[]) => join(root, ...parts);
function touch(path: string, seconds?: number) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  if (seconds) utimesSync(path, seconds, seconds);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-rows-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-rowstore-"));
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const ep = (season: number, n: number) =>
  at("Arcane", `Season ${season}`, `Arcane S0${season}E0${n}.mkv`);

/** Two shows, two films; mtimes make Recently added deterministic. */
function seed() {
  for (const n of [1, 2, 3]) touch(ep(1, n), 1000 + n);
  touch(ep(2, 1), 1004);
  touch(at("Dark", "Dark S01E01.mkv"), 1010);
  touch(at("Dark", "Dark S01E02.mkv"), 1011);
  touch(at("Elemental.2023.mkv"), 1020);
  touch(at("Heat.mkv"), 1005);
}

async function start(history?: Record<string, unknown>) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  if (history) store.write("history", { items: history });
  h = await startHarness(store);
  await h.app.core.library.settled();
  phone = await h.connectPhone();
  await phone.press("home");
  await focusOn("library");
  await phone.press("ok");
}

const page = () => h.screen.last.library!;
const rowIds = () => page().rows!.map((r) => r.id);
const row = (id: string) => page().rows!.find((r) => r.id === id)!.entries;
const focusedId = () => h.screen.last.focusedId;

async function focusOn(id: string) {
  for (let i = 0; i < 80 && focusedId() !== id; i++) {
    const { grid } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId())!;
    const t = grid.find((x) => x.id === id)!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(focusedId()).toBe(id);
}

describe("Library first page rows", () => {
  test("rows come in order and empty ones are hidden", async () => {
    seed();
    await start();
    expect(rowIds()).toEqual(["shows", "films", "recent"]);
    expect(row("shows").map((e) => e.title)).toEqual(["Arcane", "Dark"]);
    expect(row("films").map((e) => e.title)).toEqual(["Elemental", "Heat"]);

    const arcane = at("Arcane", "Season 1", "Arcane S01E01.mkv");
    await h.stop();
    await start({ [arcane]: { duration: 2400, watched: true, at: 5 } });
    expect(rowIds()).toEqual(["nextup", "shows", "films", "recent"]);

    const film = at("Elemental.2023.mkv");
    await h.stop();
    await start({ [film]: { position: 600, duration: 6000, at: 9 } });
    expect(rowIds()).toEqual(["continue", "shows", "films", "recent"]);
  });

  test("no rows when the Library has no videos; Folders still show", async () => {
    mkdirSync(at("Empty"));
    await start();
    expect(page().rows).toEqual([]);
    expect(page().entries.map((e) => e.path)).toEqual([root]);
    expect(focusedId()).toBe(root);
  });

  test("focus starts on the first row's first tile", async () => {
    seed();
    await start();
    expect(focusedId()).toBe("shows:show:arcane");
  });

  test("Show tiles say how much of the current season is left, or Watched", async () => {
    seed();
    const watched = (n: number) => ({ duration: 2400, watched: true, at: n });
    await start({
      [ep(1, 1)]: watched(1),
      [ep(1, 2)]: watched(2),
      [ep(1, 3)]: watched(3),
      [at("Dark", "Dark S01E01.mkv")]: watched(4),
      [at("Dark", "Dark S01E02.mkv")]: watched(5),
    });
    expect(row("shows").map((e) => [e.title, e.line])).toEqual([
      ["Arcane", "S2 · 1 left"],
      ["Dark", "Watched"],
    ]);
  });

  test("Next up holds the episode after the last watched one, most recent show first", async () => {
    seed();
    const watched = (n: number) => ({ duration: 2400, watched: true, at: n });
    await start({
      [ep(1, 1)]: watched(1),
      [ep(1, 2)]: watched(2),
      [at("Dark", "Dark S01E01.mkv")]: watched(3),
    });
    expect(row("nextup").map((e) => [e.path, e.line])).toEqual([
      [at("Dark", "Dark S01E02.mkv"), "Dark · S1 E2"],
      [ep(1, 3), "Arcane · S1 E3"],
    ]);
  });

  test("Recently added is newest first, up to 20", async () => {
    seed();
    for (let i = 0; i < 25; i++) touch(at(`Film ${String(i).padStart(2, "0")}.mkv`), 100 + i);
    await start();
    const recent = row("recent");
    expect(recent).toHaveLength(20);
    expect(recent.slice(0, 4).map((e) => e.title)).toEqual(["Elemental", "Dark", "Heat", "Arcane"]);
  });

  test("Folders still open the folder views", async () => {
    seed();
    await start();
    await focusOn(root);
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("folder");
    expect(h.screen.last.state.folderPath).toBe(root);
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("library");
    expect(focusedId()).toBe(root);
  });

  test("OK on a show tile opens its first folder for now", async () => {
    seed();
    await start();
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("folder");
    expect(h.screen.last.state.folderPath).toBe(at("Arcane", "Season 1"));
  });

  test("OK on a film resumes it; OK on an episode in Next up plays it", async () => {
    seed();
    const film = at("Elemental.2023.mkv");
    await start({
      [film]: { position: 600, duration: 6000, at: 9 },
      [ep(1, 1)]: { duration: 2400, watched: true, at: 1 },
    });
    expect(h.screen.last.focusedId).toBe(`continue:${film}`);
    await phone.press("ok");
    expect(h.player.calls.find((c) => c.call === "load")!.args[0]).toBe(film);
    expect(h.player.calls.find((c) => c.call === "load")!.args[1]).toMatchObject({
      startSeconds: 600,
    });
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("library");
    await focusOn(`nextup:${ep(1, 2)}`);
    await phone.press("ok");
    expect(h.player.calls.filter((c) => c.call === "load").at(-1)!.args[0]).toBe(ep(1, 2));
  });

  test("a film on a missing drive is dimmed and OK shows the toast", async () => {
    seed();
    await start();
    rmSync(at("Elemental.2023.mkv"));
    rmSync(root, { recursive: true });
    await h.app.core.library.refresh([root]);
    expect(row("films")[0]).toMatchObject({ missing: true });
    expect(row("shows")[0]).toMatchObject({ missing: true });
    await focusOn(row("films")[0]!.id!);
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("library");
    expect(h.screen.last.state.toast).toBe("Connect the drive to see this folder");
    expect(h.player.calls.some((c) => c.call === "load")).toBe(false);
  });

  test("focus stays on its tile when a scan adds titles above it", async () => {
    seed();
    await start();
    await focusOn("shows:show:dark");
    touch(at("Aaa Show", "Aaa Show S01E01.mkv"), 2000);
    await h.app.core.library.refresh([root]);
    expect(row("shows").map((e) => e.title)).toEqual(["Aaa Show", "Arcane", "Dark"]);
    expect(h.screen.last.focusedId).toBe("shows:show:dark");
    expect(h.screen.last.state.view).toBe("library");
  });

  test("the featured area follows focus across rows", async () => {
    seed();
    await start();
    const featured = () => {
      const lib = page();
      const all = [...lib.rows!.flatMap((r) => r.entries), ...lib.entries];
      return all.find((e) => (e.id ?? e.path) === focusedId())!.feature;
    };
    expect(featured()).toEqual({ kind: "Show", title: "Arcane", sub: "2 seasons" });
    await phone.press("down");
    expect(featured()).toEqual({ kind: "Film", title: "Elemental", sub: "2023" });
    await phone.press("right");
    expect(featured()).toEqual({ kind: "Film", title: "Heat" });
    await focusOn(root);
    expect(featured()).toEqual({ kind: "Folder", title: basename(root).replaceAll("-", " ") });
  });
});
