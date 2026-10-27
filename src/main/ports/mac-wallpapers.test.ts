import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
