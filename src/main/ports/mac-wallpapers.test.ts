import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { RealMacWallpapers } from "./mac-wallpapers.ts";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("RealMacWallpapers lists a folder without following anything", () => {
  test("reports files, folders and symlinks as what they are, one level deep", async () => {
    dir = mkdtempSync(join(tmpdir(), "couch-mac-"));
    const outside = join(dir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.jpg"), "x");
    const pics = join(dir, "pics");
    mkdirSync(join(pics, "Sub"), { recursive: true });
    writeFileSync(join(pics, "a.jpg"), "abc");
    writeFileSync(join(pics, "Sub", "deep.jpg"), "x");
    symlinkSync(join(outside, "secret.jpg"), join(pics, "link.jpg"));
    symlinkSync(outside, join(pics, "linkdir"));
    const mac = new RealMacWallpapers(dir, async () => "/chosen");
    const listed = mac.listFolder(pics)!;
    const kind = (name: string) => listed.find((e) => e.name === name)?.kind;
    expect(listed.map((e) => e.name).sort()).toEqual(["Sub", "a.jpg", "link.jpg", "linkdir"]);
    expect(kind("a.jpg")).toBe("file");
    expect(kind("Sub")).toBe("dir");
    expect(kind("link.jpg")).toBe("symlink");
    expect(kind("linkdir")).toBe("symlink");
    expect(listed.find((e) => e.name === "a.jpg")).toMatchObject({
      size: 3,
      path: join(pics, "a.jpg"),
    });
    expect(mac.listFolder(join(dir, "missing"))).toBeUndefined();
    expect(mac.defaultFolder()).toBe(join(dir, "Pictures", "Wallpapers"));
    expect(await mac.chooseFolder("/x")).toBe("/chosen");
  });
});

describe("RealMacWallpapers reads the desktop picture without blocking", () => {
  test("it is asynchronous: the event loop keeps running while the read is pending", async () => {
    dir = mkdtempSync(join(tmpdir(), "couch-mac-"));
    const pic = join(dir, "pic.jpg");
    writeFileSync(pic, "abc");
    let finish: (out: string) => void = () => {};
    const mac = new RealMacWallpapers(
      dir,
      async () => undefined,
      () => new Promise((resolve) => (finish = resolve)),
    );
    const pending = mac.desktopPicture();
    let ticked = false;
    await new Promise((r) => setTimeout(r, 10)).then(() => (ticked = true));
    expect(ticked).toBe(true);
    finish(`${pic}\n`);
    expect(await pending).toMatchObject({
      name: "pic.jpg",
      path: realpathSync(pic),
      size: 3,
      kind: "file",
    });
  });

  test("a failed or timed-out read is no desktop picture", async () => {
    dir = mkdtempSync(join(tmpdir(), "couch-mac-"));
    const mac = new RealMacWallpapers(
      dir,
      async () => undefined,
      () => Promise.reject(new Error("timed out")),
    );
    expect(await mac.desktopPicture()).toBeUndefined();
  });

  test("a .madesktop entry resolves to its thumbnail beside it; none means nothing", async () => {
    dir = mkdtempSync(join(tmpdir(), "couch-mac-"));
    mkdirSync(join(dir, ".thumbnails"));
    writeFileSync(join(dir, ".thumbnails", "Big Sur.heic"), "x");
    const at = (name: string) =>
      new RealMacWallpapers(
        dir,
        async () => undefined,
        async () => join(dir, name),
      ).desktopPicture();
    expect((await at("Big Sur.madesktop"))?.name).toBe("Big Sur.heic");
    expect(await at("Other.madesktop")).toBeUndefined();
  });
});
