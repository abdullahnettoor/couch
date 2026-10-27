import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { fitWithin, meanBrightness, pictureKind, WallpaperFilesOnDisk } from "./pictures.ts";

describe("pictureKind", () => {
  const heic = (brand: string) =>
    Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`), Buffer.alloc(12)]);
  test("accepts JPEG, PNG and HEIC magic bytes only", () => {
    expect(pictureKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("jpeg");
    expect(pictureKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      "png",
    );
    expect(pictureKind(heic("heic"))).toBe("heic");
    expect(pictureKind(heic("mif1"))).toBe("heic");
    expect(pictureKind(heic("isom"))).toBeUndefined();
    expect(pictureKind(Buffer.from("GIF89a....."))).toBeUndefined();
    expect(pictureKind(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeUndefined();
    expect(pictureKind(Buffer.from("#!/bin/sh\n"))).toBeUndefined();
    expect(pictureKind(Buffer.alloc(0))).toBeUndefined();
  });
});

describe("fitWithin", () => {
  test("shrinks to fit 3840 × 2160, keeping the shape, and never enlarges", () => {
    expect(fitWithin(7680, 4320)).toEqual({ width: 3840, height: 2160 });
    expect(fitWithin(6016, 6016)).toEqual({ width: 2160, height: 2160 });
    expect(fitWithin(5120, 2880)).toEqual({ width: 3840, height: 2160 });
    expect(fitWithin(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("meanBrightness", () => {
  const px = (b: number, g: number, r: number) => [b, g, r, 255];
  test("black is 0 and white is 1", () => {
    expect(meanBrightness(Uint8Array.from(px(0, 0, 0)), true)).toBe(0);
    expect(meanBrightness(Uint8Array.from(px(255, 255, 255)), true)).toBeCloseTo(1);
  });
  test("an even mix of black and white is a half", () => {
    const bitmap = Uint8Array.from([...px(0, 0, 0), ...px(255, 255, 255)]);
    expect(meanBrightness(bitmap, true)).toBeCloseTo(0.5);
  });
  test("green counts for more than red, and BGRA differs from RGBA", () => {
    expect(meanBrightness(Uint8Array.from(px(0, 255, 0)), true)).toBeCloseTo(0.7152);
    expect(meanBrightness(Uint8Array.from(px(0, 0, 255)), true)).toBeCloseTo(0.2126);
    expect(meanBrightness(Uint8Array.from([255, 0, 0, 255]), false)).toBeCloseTo(0.2126);
  });
  test("an empty bitmap counts as bright, so the photo is dimmed the most", () => {
    expect(meanBrightness(new Uint8Array(), true)).toBe(1);
  });
});

describe("WallpaperFilesOnDisk", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  test("saves <key>.jpg and <key>.thumb.jpg, serves file URLs, lists keys, removes both, refuses odd keys", () => {
    dir = mkdtempSync(join(tmpdir(), "couch-wallpapers-"));
    const files = new WallpaperFilesOnDisk(join(dir, "wallpapers"));
    expect(files.keys()).toEqual([]);
    expect(files.has("0123456789ab")).toBe(false);
    files.save("0123456789ab", Buffer.from("jpeg"), Buffer.from("thumb"));
    expect(readFileSync(join(dir, "wallpapers", "0123456789ab.jpg"), "utf8")).toBe("jpeg");
    expect(readFileSync(join(dir, "wallpapers", "0123456789ab.thumb.jpg"), "utf8")).toBe("thumb");
    expect(files.has("0123456789ab")).toBe(true);
    expect(files.keys()).toEqual(["0123456789ab"]);
    expect(files.url("0123456789ab")).toMatch(/^file:\/\/\/.*\/wallpapers\/0123456789ab\.jpg$/);
    expect(files.thumbUrl("0123456789ab")).toMatch(/\/0123456789ab\.thumb\.jpg$/);
    files.remove("0123456789ab");
    expect(existsSync(join(dir, "wallpapers", "0123456789ab.jpg"))).toBe(false);
    expect(existsSync(join(dir, "wallpapers", "0123456789ab.thumb.jpg"))).toBe(false);
    expect(() => files.save("../../etc/passwd", Buffer.from("x"), Buffer.from("x"))).toThrow();
    expect(() => files.url("a/b")).toThrow();
    expect(() => files.remove("..")).toThrow();
    expect(() => files.has("..")).toThrow();
  });

  test("a key with only one of its two files is not there", () => {
    dir = mkdtempSync(join(tmpdir(), "couch-wallpapers-"));
    const files = new WallpaperFilesOnDisk(join(dir, "wallpapers"));
    files.save("0123456789ab", Buffer.from("jpeg"), Buffer.from("thumb"));
    rmSync(join(dir, "wallpapers", "0123456789ab.thumb.jpg"));
    expect(files.has("0123456789ab")).toBe(false);
  });
});
