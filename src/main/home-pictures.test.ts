import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { FakeConverter, FakeMacWallpapers, FakeWallpaperFiles, macFile } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

const FOLDER = "/Users/me/Pictures/Wallpapers";
const APPLE = "/System/Library/Desktop Pictures";
const HOUR = 60 * 60 * 1000;

let storeDir: string;
let store: FileStore;
let h: Harness;
let phone: FakePhone;
let kept: Harness["wallpapers"] | undefined;
beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "couch-pictures-"));
  store = new FileStore(storeDir);
  kept = undefined;
});
afterEach(async () => {
  await h?.stop();
  rmSync(storeDir, { recursive: true, force: true });
});

const home = () => h.screen.last.home!;
const saved = () => store.read<Record<string, any>>("home", {});
const labels = () => h.screen.last.grid.map((g) => g.label);
const pictures = () => home().pictures!;

/** The fake Mac as the household's: a folder with pictures, the desktop picture, and Apple's folder. */
function fillMac(w: Harness["wallpapers"]) {
  w.mac.folders.set(FOLDER, [
    macFile(FOLDER, "b-lake-3840x2160-123456.jpg"),
    macFile(FOLDER, "a_Desert.heic"),
    macFile(FOLDER, "c.png"),
    macFile(FOLDER, "notes.txt"),
    macFile(FOLDER, "movie.mov"),
    macFile(FOLDER, ".hidden.jpg"),
    macFile(FOLDER, "Sub", { kind: "dir" }),
    macFile(FOLDER, "link.jpg", { kind: "symlink" }),
  ]);
  w.mac.folders.set(`${FOLDER}/Sub`, [macFile(`${FOLDER}/Sub`, "deep.jpg")]);
  w.mac.desktop = macFile(FOLDER, "c.png");
  w.mac.apple = [
    macFile(APPLE, "Mac Blue.heic"),
    macFile(APPLE, "Sonoma.heic"),
    macFile(APPLE, "Big Sur.madesktop"),
    macFile(APPLE, "Sequoia.madesktop"),
    macFile(APPLE, ".thumbnails", { kind: "dir" }),
  ];
}

const fresh = (): Harness["wallpapers"] => ({
  mac: new FakeMacWallpapers(),
  converter: new FakeConverter(),
  files: new FakeWallpaperFiles(),
});

/** Starts with the fake Mac set up by `setup` (before Couch first reads it), unless the test already made `kept`. */
const start = async (setup: (w: Harness["wallpapers"]) => void = fillMac) => {
  if (!kept) {
    kept = fresh();
    setup(kept);
  }
  h = await startHarness(store, { wallpapers: kept });
  phone = await h.connectPhone();
};

/** Restart on the same Store and the same converted copies, the way the app is closed and reopened. */
const restart = async () => {
  await h.stop();
  h = await startHarness(store, { wallpapers: kept });
  phone = await h.connectPhone();
};

async function openHomePage() {
  await phone.press("home");
  await phone.press("up");
  await phone.press("ok");
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== "Home"; i++) await phone.press("down");
  await phone.press("ok");
  expect(h.screen.last.state.view).toBe("settingsHome");
  await h.settle();
}

async function focusTile(id: string) {
  for (let i = 0; i < 80 && h.screen.last.focusedId !== id; i++) await phone.press("right");
  expect(h.screen.last.focusedId).toBe(id);
}

async function chooseTile(id: string) {
  await focusTile(id);
  await phone.press("ok");
  await h.settle();
}

describe("the tiles", () => {
  test("six built-ins, Same as Mac, the folder's pictures by name, then Apple's heic wallpapers", async () => {
    await start();
    await openHomePage();
    expect(labels()).toEqual([
      "Couch",
      "Dusk",
      "Ocean",
      "Forest",
      "Ember",
      "Graphite",
      "Same as Mac",
      "A Desert",
      "B lake",
      "C",
      "Mac Blue",
      "Sonoma",
      "Show artwork behind Resume",
      "Wallpaper folder",
      "Slideshow",
    ]);
    const tiles = h.screen.last.grid.filter((g) => g.r === 0);
    expect(tiles.map((g) => g.c)).toEqual(tiles.map((_, i) => i));
  });

  test("files that aren't images, hidden files, subfolders and symlinks are ignored", async () => {
    await start();
    await openHomePage();
    const files = pictures()
      .filter((p) => p.kind === "folder")
      .map((p) => p.file);
    expect(files).toEqual(["a_Desert.heic", "b-lake-3840x2160-123456.jpg", "c.png"]);
    expect(h.wallpapers.converter.converted.some((p) => p.includes("deep"))).toBe(false);
    expect(h.wallpapers.converter.converted.some((p) => p.endsWith("notes.txt"))).toBe(false);
  });

  test(".madesktop entries without a full image are skipped; only heic files at the top level of Apple's folder show", async () => {
    await start();
    await openHomePage();
    expect(
      pictures()
        .filter((p) => p.kind === "apple")
        .map((p) => p.file),
    ).toEqual(["Mac Blue.heic", "Sonoma.heic"]);
  });

  test("at most 48 folder pictures", async () => {
    await start((w) =>
      w.mac.folders.set(
        FOLDER,
        Array.from({ length: 60 }, (_, i) => macFile(FOLDER, `p${String(i).padStart(2, "0")}.jpg`)),
      ),
    );
    await openHomePage();
    expect(pictures().filter((p) => p.kind === "folder")).toHaveLength(48);
  });

  test("Same as Mac is always offered, even when the Mac has no usable desktop picture", async () => {
    await start((w) => w.mac.folders.set(FOLDER, []));
    await openHomePage();
    expect(pictures()[0]).toEqual({ kind: "mac", label: "Same as Mac" });
  });

  test("a picture that fails its checks is skipped quietly", async () => {
    await start((w) => {
      fillMac(w);
      w.converter.fails.add(`${FOLDER}/c.png`);
    });
    await openHomePage();
    expect(labels()).not.toContain("C");
    expect(h.screen.last.state.toast ?? "").not.toMatch(/picture|wallpaper/i);
    // Same as Mac is that same picture: it stays a tile but can't be chosen.
    expect(pictures()[0]).toEqual({ kind: "mac", label: "Same as Mac" });
  });

  test("thumbnails and the dim arrive as each picture is converted, brighter ones dimmed more", async () => {
    await start((w) => {
      fillMac(w);
      w.converter.brightness.set(`${FOLDER}/c.png`, 1);
      w.converter.brightness.set(`${FOLDER}/a_Desert.heic`, 0);
    });
    await openHomePage();
    const byFile = (f: string) => pictures().find((p) => p.file === f)!;
    expect(byFile("c.png").dim).toBe(0.65);
    expect(byFile("a_Desert.heic").dim).toBe(0.35);
    expect(byFile("c.png").thumb).toMatch(
      /^file:\/\/\/userData\/wallpapers\/[0-9a-f]{12}\.thumb\.jpg$/,
    );
    expect(byFile("c.png").url).toMatch(/^file:\/\/\/userData\/wallpapers\/[0-9a-f]{12}\.jpg$/);
  });
});

describe("choosing", () => {
  test("a folder picture is stored, shown with its converted file and survives a restart", async () => {
    await start();
    await openHomePage();
    await chooseTile("pic:folder:c.png");
    expect(saved().wallpaper).toEqual({ kind: "folder", file: "c.png" });
    const tile = pictures().find((p) => p.file === "c.png")!;
    expect(home().wallpaper).toEqual({ kind: "folder", file: "c.png" });
    expect(tile.url).toBeDefined();
    const key = /([0-9a-f]{12})\.jpg$/.exec(tile.url!)![1]!;
    expect(h.wallpapers.files.files.get(key)!.jpeg.toString()).toBe(`jpeg:${FOLDER}/c.png`);
    await restart();
    expect(home().wallpaper).toEqual({ kind: "folder", file: "c.png" });
    await h.settle();
    expect(pictures().find((p) => p.file === "c.png")!.url).toBe(tile.url);
  });

  test("an Apple wallpaper is stored and resolves to its converted file", async () => {
    await start();
    await openHomePage();
    await chooseTile("pic:apple:Sonoma.heic");
    expect(saved().wallpaper).toEqual({ kind: "apple", file: "Sonoma.heic" });
    expect(pictures().find((p) => p.file === "Sonoma.heic")!.url).toBeDefined();
    await restart();
    expect(home().wallpaper).toEqual({ kind: "apple", file: "Sonoma.heic" });
  });

  test("Same as Mac is stored and shows the desktop picture's converted copy", async () => {
    await start();
    await openHomePage();
    await chooseTile("pic:mac");
    expect(saved().wallpaper).toEqual({ kind: "mac" });
    expect(home().wallpaper).toEqual({ kind: "mac" });
    const mac = pictures()[0]!;
    expect(mac.url).toBeDefined();
    const key = /([0-9a-f]{12})\.jpg$/.exec(mac.url!)![1]!;
    expect(h.wallpapers.files.files.get(key)!.jpeg.toString()).toBe(`jpeg:${FOLDER}/c.png`);
    await restart();
    expect(home().wallpaper).toEqual({ kind: "mac" });
  });

  test("choosing Same as Mac when the desktop picture can't be used says so and keeps the wallpaper", async () => {
    await start((w) => w.mac.folders.set(FOLDER, []));
    await openHomePage();
    await chooseTile("pic:mac");
    expect(h.screen.last.state.toast).toBe("Couch can't use the Mac's desktop picture");
    expect(saved().wallpaper).toBeUndefined();
  });

  test("focus previews a picture without saving it, and Back keeps the saved choice", async () => {
    await start();
    await openHomePage();
    await focusTile("pic:folder:c.png");
    expect(home().preview).toEqual({ kind: "folder", file: "c.png" });
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
    expect(saved()).toEqual(expect.not.objectContaining({ wallpaper: expect.anything() }));
    await phone.press("back");
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
  });

  test("the chosen picture's tile has the focus when the page opens", async () => {
    store.write("home", { wallpaper: { kind: "apple", file: "Mac Blue.heic" } });
    await start();
    await openHomePage();
    expect(h.screen.last.focusedLabel).toBe("Mac Blue");
  });

  test("a stored choice with a file name that is a path never reaches a file", async () => {
    store.write("home", { wallpaper: { kind: "folder", file: "../../etc/passwd" } });
    await start();
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
  });
});

describe("falling back to Couch", () => {
  test("when the chosen folder picture disappears", async () => {
    await start();
    await openHomePage();
    await chooseTile("pic:folder:c.png");
    await phone.press("back");
    h.wallpapers.mac.folders.set(
      FOLDER,
      h.wallpapers.mac.folders.get(FOLDER)!.filter((e) => e.name !== "c.png"),
    );
    h.clock.advance(61_000);
    await phone.press("home");
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
  });

  test("when the Mac has no desktop picture any more", async () => {
    store.write("home", { wallpaper: { kind: "mac" } });
    await start();
    await h.settle();
    expect(home().wallpaper).toEqual({ kind: "mac" });
    h.wallpapers.mac.desktop = undefined;
    h.clock.advance(61_000);
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
  });

  test("a picture that was never there", async () => {
    store.write("home", { wallpaper: { kind: "apple", file: "Gone.heic" } });
    await start();
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
  });
});

describe("Same as Mac follows the desktop picture", () => {
  test("a changed desktop picture shows after Home is shown again, at most once a minute", async () => {
    store.write("home", { wallpaper: { kind: "mac" } });
    await start();
    await h.settle();
    const first = pictures()[0]!.url;
    expect(first).toBeDefined();
    const reads = h.wallpapers.mac.desktopReads;
    h.wallpapers.mac.desktop = macFile(FOLDER, "a_Desert.heic", { mtimeMs: 5 });
    await phone.press("up");
    await phone.press("back");
    expect(h.wallpapers.mac.desktopReads).toBe(reads);
    expect(pictures()[0]!.url).toBe(first);
    h.clock.advance(61_000);
    await h.settle();
    expect(h.wallpapers.mac.desktopReads).toBeGreaterThan(reads);
    const second = pictures()[0]!.url;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(h.wallpapers.converter.converted).toContain(`${FOLDER}/a_Desert.heic`);
  });

  test("the old copy of the desktop picture is removed once nothing uses it", async () => {
    store.write("home", { wallpaper: { kind: "mac" } });
    await start((w) => {
      w.mac.folders.set(FOLDER, []);
      w.mac.desktop = macFile("/Users/me/Pictures/Other", "old.jpg");
    });
    await h.settle();
    expect(h.wallpapers.files.keys()).toHaveLength(1);
    h.wallpapers.mac.desktop = macFile("/Users/me/Pictures/Other", "new.jpg");
    h.clock.advance(61_000);
    await h.settle();
    expect(h.wallpapers.files.keys()).toHaveLength(1);
    expect(h.wallpapers.files.files.get(h.wallpapers.files.keys()[0]!)!.jpeg.toString()).toBe(
      "jpeg:/Users/me/Pictures/Other/new.jpg",
    );
  });
});

describe("the wallpaper folder", () => {
  test("defaults to ~/Pictures/Wallpapers and shows on its row, shortened", async () => {
    await start();
    await openHomePage();
    expect(home().folder).toBe("~/Pictures/Wallpapers");
  });

  test("the chooser opens from the row, and the chosen path is stored, shown and listed", async () => {
    await start((w) => {
      fillMac(w);
      w.mac.folders.set("/Volumes/Pics", [macFile("/Volumes/Pics", "z.jpg")]);
      w.mac.chooses = "/Volumes/Pics";
    });
    await openHomePage();
    await phone.press("down");
    await phone.press("down");
    expect(h.screen.last.focusedLabel).toBe("Wallpaper folder");
    await phone.press("ok");
    await h.settle();
    expect(h.wallpapers.mac.choosers).toEqual([FOLDER]);
    expect(saved().folder).toBe("/Volumes/Pics");
    expect(home().folder).toBe("/Volumes/Pics");
    expect(
      pictures()
        .filter((p) => p.kind === "folder")
        .map((p) => p.file),
    ).toEqual(["z.jpg"]);
    await restart();
    expect(home().folder).toBe("/Volumes/Pics");
  });

  test("cancelling the chooser changes nothing", async () => {
    await start((w) => {
      fillMac(w);
      w.mac.chooses = undefined;
    });
    await openHomePage();
    await phone.press("down");
    await phone.press("down");
    await phone.press("ok");
    await h.settle();
    expect(saved().folder).toBeUndefined();
    expect(home().folder).toBe("~/Pictures/Wallpapers");
  });

  test("a chosen folder picture that is not in the new folder falls back to Couch, and the old copies are removed", async () => {
    await start((w) => {
      fillMac(w);
      w.mac.folders.set("/Volumes/Pics", [macFile("/Volumes/Pics", "z.jpg")]);
      w.mac.chooses = "/Volumes/Pics";
    });
    await openHomePage();
    await chooseTile("pic:folder:c.png");
    const before = h.wallpapers.files.keys().length;
    await phone.press("down");
    await phone.press("down");
    await phone.press("ok");
    await h.settle();
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
    // Same as Mac and Apple's stay; the three old folder copies (c.png is also the desktop picture) go, z.jpg comes.
    expect(h.wallpapers.files.keys().length).toBeLessThan(before + 1);
    expect([...h.wallpapers.files.files.values()].map((f) => f.jpeg.toString())).not.toContain(
      `jpeg:${FOLDER}/a_Desert.heic`,
    );
  });

  test("an unreadable folder shows no folder pictures and keeps their copies", async () => {
    await start();
    await openHomePage();
    const copies = h.wallpapers.files.keys().length;
    h.wallpapers.mac.folders.delete(FOLDER);
    await openHomePage();
    expect(pictures().filter((p) => p.kind === "folder")).toHaveLength(0);
    expect(h.wallpapers.files.keys()).toHaveLength(copies);
  });
});

describe("conversion is cached", () => {
  test("each picture is converted once, however often the page opens or Couch restarts", async () => {
    await start();
    await openHomePage();
    const n = h.wallpapers.converter.converted.length;
    // Same as Mac and the folder's c.png are one file: converted once.
    expect(n).toBe(5);
    await phone.press("back");
    await openHomePage();
    expect(h.wallpapers.converter.converted).toHaveLength(n);
    await restart();
    await openHomePage();
    expect(h.wallpapers.converter.converted).toHaveLength(n);
  });

  test("a picture whose modification time changed is converted again, and the old copy goes", async () => {
    await start();
    await openHomePage();
    const path = `${FOLDER}/b-lake-3840x2160-123456.jpg`;
    const before = h.wallpapers.converter.converted.filter((p) => p === path).length;
    expect(before).toBe(1);
    const keys = h.wallpapers.files.keys().length;
    h.wallpapers.mac.folders.set(
      FOLDER,
      h.wallpapers.mac.folders
        .get(FOLDER)!
        .map((e) =>
          e.name === "b-lake-3840x2160-123456.jpg" ? { ...e, mtimeMs: e.mtimeMs + 1 } : e,
        ),
    );
    await phone.press("back");
    await openHomePage();
    expect(h.wallpapers.converter.converted.filter((p) => p === path)).toHaveLength(2);
    expect(h.wallpapers.files.keys()).toHaveLength(keys);
  });

  test("a changed size converts again too", async () => {
    await start();
    await openHomePage();
    h.wallpapers.mac.apple = h.wallpapers.mac.apple.map((e) =>
      e.name === "Sonoma.heic" ? { ...e, size: e.size + 5 } : e,
    );
    await phone.press("back");
    await openHomePage();
    expect(
      h.wallpapers.converter.converted.filter((p) => p === `${APPLE}/Sonoma.heic`),
    ).toHaveLength(2);
  });

  test("pictures that are in no source any more lose their copies", async () => {
    await start();
    await openHomePage();
    const before = h.wallpapers.files.keys().length;
    h.wallpapers.mac.folders.set(FOLDER, [macFile(FOLDER, "c.png")]);
    h.wallpapers.mac.apple = [];
    await phone.press("back");
    await openHomePage();
    // c.png is both the folder's and the desktop picture: one copy. Everything else is gone.
    expect(before).toBeGreaterThan(2);
    expect(h.wallpapers.files.keys()).toHaveLength(1);
    expect(saved().dims).toEqual({ [h.wallpapers.files.keys()[0]!]: 0.5 });
  });

  test("stray copies nothing refers to are removed when the page opens", async () => {
    await start();
    h.wallpapers.files.save("deadbeef0001", Buffer.from("x"), Buffer.from("y"));
    await openHomePage();
    expect(h.wallpapers.files.keys()).not.toContain("deadbeef0001");
  });

  test("only the picture in use is converted until Settings → Home is opened", async () => {
    store.write("home", { wallpaper: { kind: "apple", file: "Sonoma.heic" } });
    await start();
    await h.settle();
    expect(h.wallpapers.converter.converted).toEqual([`${APPLE}/Sonoma.heic`]);
  });

  test("the chosen picture is converted before the rest", async () => {
    await start();
    await phone.press("up");
    await phone.press("ok");
    for (let i = 0; i < 12 && h.screen.last.focusedLabel !== "Home"; i++) await phone.press("down");
    await phone.press("ok");
    await phone.press("right");
    await h.settle();
    expect(h.wallpapers.converter.converted.length).toBeGreaterThan(1);
  });
});

describe("slideshow", () => {
  const folderWallpaper = { kind: "folder", file: "a_Desert.heic" };

  test("the row cycles Off, Every hour, Every day and is stored", async () => {
    await start();
    await openHomePage();
    await phone.press("down");
    await phone.press("down");
    await phone.press("down");
    expect(h.screen.last.focusedLabel).toBe("Slideshow");
    expect(home().slideshow).toBe("off");
    await phone.press("ok");
    expect(home().slideshow).toBe("hour");
    expect(saved().slideshow).toBe("hour");
    await phone.press("ok");
    expect(home().slideshow).toBe("day");
    await phone.press("ok");
    expect(home().slideshow).toBe("off");
    await phone.press("ok");
    await restart();
    expect(home().slideshow).toBe("hour");
  });

  test("every hour, Home moves to the next folder picture by name, and wraps", async () => {
    store.write("home", { wallpaper: folderWallpaper, slideshow: "hour" });
    await start();
    await h.settle();
    h.clock.advance(HOUR - 1000);
    expect(home().wallpaper).toEqual(folderWallpaper);
    h.clock.advance(120_000);
    expect(home().wallpaper).toEqual({ kind: "folder", file: "b-lake-3840x2160-123456.jpg" });
    h.clock.advance(HOUR);
    expect(home().wallpaper).toEqual({ kind: "folder", file: "c.png" });
    h.clock.advance(HOUR);
    expect(home().wallpaper).toEqual(folderWallpaper);
    expect(saved().wallpaper).toEqual(folderWallpaper);
    await h.settle();
    expect(pictures().find((p) => p.file === "a_Desert.heic")!.url).toBeDefined();
  });

  test("every day waits a day", async () => {
    store.write("home", { wallpaper: folderWallpaper, slideshow: "day" });
    await start();
    h.clock.advance(23 * HOUR);
    expect(home().wallpaper).toEqual(folderWallpaper);
    h.clock.advance(2 * HOUR);
    expect(home().wallpaper).toEqual({ kind: "folder", file: "b-lake-3840x2160-123456.jpg" });
  });

  test("off, or with a built-in, Apple or Same as Mac wallpaper, it never moves", async () => {
    for (const [slideshow, wallpaper] of [
      ["off", folderWallpaper],
      ["hour", { kind: "builtin", id: "dusk" }],
      ["hour", { kind: "apple", file: "Sonoma.heic" }],
      ["hour", { kind: "mac" }],
    ] as const) {
      store.write("home", { wallpaper, slideshow });
      kept = undefined;
      await h?.stop();
      await start();
      h.clock.advance(5 * HOUR);
      expect(home().wallpaper, JSON.stringify({ slideshow, wallpaper })).toEqual(wallpaper);
    }
  });

  test("choosing a picture by hand holds it for the full interval", async () => {
    store.write("home", { wallpaper: folderWallpaper, slideshow: "hour" });
    await start();
    h.clock.advance(50 * 60_000);
    await openHomePage();
    await chooseTile("pic:folder:c.png");
    await phone.press("back");
    h.clock.advance(30 * 60_000);
    expect(home().wallpaper).toEqual({ kind: "folder", file: "c.png" });
    h.clock.advance(31 * 60_000);
    expect(home().wallpaper).toEqual(folderWallpaper);
  });
});

describe("107's phone photos", () => {
  test("are migrated: a photo choice becomes Couch, home.photos goes, their files are removed", async () => {
    store.write("home", {
      artwork: false,
      wallpaper: { kind: "photo", id: "aaaaaaaaaaaa" },
      photos: [
        { id: "aaaaaaaaaaaa", dim: 0.5, addedAt: 1 },
        { id: "bbbbbbbbbbbb", dim: 0.4, addedAt: 2 },
      ],
    });
    kept = fresh();
    kept.files.save("aaaaaaaaaaaa", Buffer.from("x"), Buffer.from("y"));
    kept.files.save("bbbbbbbbbbbb", Buffer.from("x"), Buffer.from("y"));
    await start(() => {});
    expect(saved().photos).toBeUndefined();
    expect(saved().wallpaper).toEqual({ kind: "builtin", id: "couch" });
    expect(saved().artwork).toBe(false);
    expect(home().wallpaper).toEqual({ kind: "builtin", id: "couch" });
    expect(kept.files.keys()).toEqual([]);
  });

  test("an odd id in the old list never becomes a file path", async () => {
    store.write("home", { photos: [{ id: "../../etc", dim: 1, addedAt: 1 }] });
    await start();
    expect(saved().photos).toBeUndefined();
  });
});
