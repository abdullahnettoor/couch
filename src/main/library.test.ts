import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { listFolder } from "./core/library.ts";
import { FileStore } from "./ports/store.ts";
import { focusFolders, startHarness, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
const touch = (...parts: string[]) => writeFileSync(join(root, ...parts), "");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-lib-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-libstore-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

describe("Titles shown for files and folders", () => {
  let h: Harness;
  afterEach(() => h?.stop());

  /** Puts the files (and folders) in a library folder and returns what the Screen shows for each. */
  async function shown(files: string[], folders: string[] = []) {
    const dir = join(root, "Cases");
    mkdirSync(dir);
    for (const f of files) writeFileSync(join(dir, f), "");
    for (const f of folders) mkdirSync(join(dir, f));
    const store = new FileStore(storeDir);
    store.write("library", { folders: [root] });
    h = await startHarness(store);
    const phone = await h.connectPhone();
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok");
    await focusFolders(h, phone);
    await phone.press("ok");
    await phone.press("ok"); // Cases
    const byName = new Map(
      h.screen.last.library!.entries.map((e) => [e.path.slice(dir.length + 1), e]),
    );
    return (name: string) => byName.get(name)!;
  }

  test.each([
    ["The.Grand.Budapest.Hotel.2014.1080p.BluRay.x264.mkv", "The Grand Budapest Hotel (2014)"],
    ["Paddington_2_2017_720p.mp4", "Paddington 2 (2017)"],
    ["Ep 2.MKV", "Ep 2"],
    ["Home Movie.mov", "Home Movie"],
    ["Blade.Runner.2049.2017.WEB-DL.x265.mkv", "Blade Runner 2049 (2017)"],
    ["Elemental.2023.1080p.mkv", "Elemental (2023)"],
  ])("movie %s has no episode line", async (file, title) => {
    const entry = (await shown([file]))(file);
    expect(entry.title).toBe(title);
    expect(entry.line).toBeUndefined();
  });

  test.each([
    ["Some.Show.S01E02.HDTV.mkv", "Episode 2", "Some Show · S1 E2"],
    ["Arcane S01E01 Welcome to the Playground.mkv", "Welcome to the Playground", "Arcane · S1 E1"],
    [
      "Kung_Fu_Panda_The_Dragon_Knight_S01E04_720p_10bit_WEBRip_2CH_x265.mkv",
      "Episode 4",
      "Kung Fu Panda The Dragon Knight · S1 E4",
    ],
    ["Show.1x02.Name.mp4", "Name", "Show · S1 E2"],
    ["Blue Eye Samurai S01E03 .mkv", "Episode 3", "Blue Eye Samurai · S1 E3"],
    ["Show S02 E05 - Pilot.mkv", "Pilot", "Show · S2 E5"],
    ["ShowS01E01Name.mkv", "Name", "Show · S1 E1"],
    ["Show1x02Name.mkv", "Name", "Show · S1 E2"],
    ["Show-S01E01-Name.mkv", "Name", "Show · S1 E1"],
    ["Show - S01E01 - Name.mkv", "Name", "Show · S1 E1"],
  ])("episode %s", async (file, title, line) => {
    const entry = (await shown([file]))(file);
    expect({ title: entry.title, line: entry.line }).toEqual({ title, line });
  });

  test("things that look like codes but aren't stay whole", async () => {
    const files = ["Movie.x264.mkv", "Clip 1080p.mkv", "Blade Runner 2049.mkv"];
    const entry = await shown(files);
    for (const f of files) expect(entry(f).line).toBeUndefined();
  });

  test("folder names lose release tags", async () => {
    const entry = await shown(
      [],
      ["Elemental (2023) [2160p] [4K] [WEB] [5.1] [YTS.MX]", "Season 2"],
    );
    expect(entry("Elemental (2023) [2160p] [4K] [WEB] [5.1] [YTS.MX]").title).toBe(
      "Elemental (2023)",
    );
    expect(entry("Season 2").title).toBe("Season 2");
  });
});

describe("listFolder", () => {
  test("subfolders first, natural order, hidden skipped, extension filter", () => {
    mkdirSync(join(root, "Season 10"));
    mkdirSync(join(root, "Season 2"));
    mkdirSync(join(root, ".hidden"));
    for (const f of [
      "Ep 10.mkv",
      "Ep 2.MP4",
      ".secret.mkv",
      "notes.txt",
      "a.avi",
      "b.mov",
      "c.m4v",
      "d.webm",
    ])
      touch(f);
    const entries = listFolder(root)!;
    expect(entries.map((e) => e.title)).toEqual([
      "Season 2",
      "Season 10",
      "a",
      "b",
      "c",
      "d",
      "Ep 2",
      "Ep 10",
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["folder", "folder", ...Array(6).fill("video")]);
  });
  test("missing folder is undefined", () => {
    expect(listFolder(join(root, "nope"))).toBeUndefined();
  });
});

describe("Library through the Remote", () => {
  let h: Harness;
  afterEach(() => h?.stop());
  const store = () => new FileStore(storeDir);
  const labels = () => h.screen.last.library!.entries.map((e) => e.title);

  async function openLibrary(existing?: Awaited<ReturnType<typeof h.connectPhone>>) {
    const phone = existing ?? (await h.connectPhone());
    await phone.press("home");
    await phone.press("down");
    await phone.press("right"); // → Library
    await phone.press("right");
    await phone.press("ok");
    await focusFolders(h, phone);
    return phone;
  }
  async function addFolder(phone: Awaited<ReturnType<typeof openLibrary>>, path: string) {
    h.mac.folderPick = path;
    await phone.press("home");
    await phone.press("up"); // Settings
    await phone.press("ok");
    await phone.press("down");
    await phone.press("ok");
    expect(h.screen.last.focusedLabel).toBe("Library folders");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("libraryFolders");
    await phone.press("ok"); // Add folder
    await phone.settle();
  }

  test("Up from the first row reaches the top strip's gear; OK opens Settings (empty, Library and folders)", async () => {
    mkdirSync(join(root, "Movies", "Sub"), { recursive: true });
    h = await startHarness(store());
    const phone = await openLibrary();
    await phone.press("up");
    expect(h.screen.last.focusedLabel).toBe("Settings");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settings");

    await addFolder(phone, join(root, "Movies"));
    await openLibrary(phone);
    await phone.press("down");
    expect(h.screen.last.focusedLabel).toBe("Movies");
    await phone.press("up");
    expect(h.screen.last.focusedLabel).toBe("Settings");
    await phone.press("down");
    await phone.press("ok");
    await phone.press("up");
    expect(h.screen.last.state.view).toBe("folder");
    expect(h.screen.last.focusedLabel).toBe("Settings");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settings");
  });

  test("empty state", async () => {
    h = await startHarness(store());
    await openLibrary();
    expect(h.screen.last.library!.emptyText).toBe(
      "No folders yet. Add one in Settings on the Mac.",
    );
  });

  test("add via picker, appears, removable, survives restart", async () => {
    mkdirSync(join(root, "Movies"));
    h = await startHarness(store());
    const phone = await openLibrary();
    await addFolder(phone, join(root, "Movies"));
    expect(h.mac.calls.some((c) => c.call === "pickFolder")).toBe(true);
    await openLibrary(phone);
    expect(h.screen.last.state.view).toBe("library");
    expect(labels()).toEqual(["Movies"]);

    await h.stop();
    h = await startHarness(store());
    const p2 = await openLibrary();
    expect(labels()).toEqual(["Movies"]);

    await p2.press("home");
    await p2.press("up");
    await p2.press("ok");
    await p2.press("down");
    await p2.press("ok");
    await p2.press("ok");
    await p2.press("down"); // the folder row
    await p2.press("ok"); // remove
    await h.stop();
    h = await startHarness(store());
    await openLibrary();
    expect(labels()).toEqual([]);
  });

  test("missing folder greyed out and explained", async () => {
    h = await startHarness(store());
    const phone = await openLibrary();
    await addFolder(phone, join(root, "UnpluggedDrive"));
    await openLibrary(phone);
    expect(h.screen.last.library!.entries[0]!.missing).toBe(true);
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("library");
    expect(h.screen.last.state.toast).toBe("Connect the drive to see this folder");
  });

  test("opening a folder focuses its first tile; coming back restores the last focus", async () => {
    mkdirSync(join(root, "Shows", "Season 1"), { recursive: true });
    for (const f of ["a.mkv", "b.mkv", "c.mkv"]) touch(join("Shows", "Season 1", f));
    touch(join("Shows", "z.mkv"));
    h = await startHarness(store());
    const phone = await openLibrary();
    await addFolder(phone, join(root, "Shows"));
    await openLibrary(phone);
    await phone.press("ok"); // Shows
    expect(h.screen.last.focusedLabel).toBe("Season 1");
    await phone.press("right");
    expect(h.screen.last.focusedLabel).toBe("z");
    await phone.press("left");
    await phone.press("ok"); // Season 1
    expect(h.screen.last.focusedLabel).toBe("a");
    await phone.press("right");
    await phone.press("right");
    expect(h.screen.last.focusedLabel).toBe("c");
    await phone.press("back");
    expect(h.screen.last.focusedLabel).toBe("Season 1");
    await phone.press("right");
    await phone.press("back");
    await phone.press("ok"); // Shows again
    expect(h.screen.last.focusedLabel).toBe("z");
    await phone.press("left");
    await phone.press("ok");
    expect(h.screen.last.focusedLabel).toBe("c");
  });

  test("nested folders, Back steps out, re-read on open, On the Screen name", async () => {
    mkdirSync(join(root, "Shows", "Season 1"), { recursive: true });
    writeFileSync(join(root, "Shows", "Season 1", "Ep.1.mkv"), "");
    h = await startHarness(store());
    h.app.screenCommand({ command: "home" });
    const phone = await openLibrary();
    await addFolder(phone, join(root, "Shows"));
    await openLibrary(phone);
    const snap = await phone.press("ok"); // open Shows
    expect(snap.where).toBe("Shows");
    expect(labels()).toEqual(["Season 1"]);
    const inner = await phone.press("ok");
    expect(inner.where).toBe("Season 1");
    expect(labels()).toEqual(["Ep 1"]);
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("player");
    await phone.press("back"); // stops playback, back in Season 1
    expect(h.screen.last.state.view).toBe("folder");

    await phone.press("back");
    expect(h.screen.last.state.folderPath).toBe(join(root, "Shows"));
    writeFileSync(join(root, "Shows", "New.Film.2020.mkv"), "");
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("library");
    await phone.press("ok");
    expect(labels()).toEqual(["Season 1", "New Film (2020)"]);
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("library");
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("home");
  });
});
