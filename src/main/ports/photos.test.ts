import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { looksLikeImage, meanBrightness, PhotoFiles } from "./photos.ts";

describe("looksLikeImage", () => {
  test("accepts JPEG and PNG magic bytes only", () => {
    expect(looksLikeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe(true);
    expect(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      true,
    );
    expect(looksLikeImage(Buffer.from("GIF89a....."))).toBe(false);
    expect(looksLikeImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(false);
    expect(looksLikeImage(Buffer.from("#!/bin/sh\n"))).toBe(false);
    expect(looksLikeImage(Buffer.alloc(0))).toBe(false);
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

describe("PhotoFiles", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  test("saves wallpapers/<id>.jpg, serves a file URL, removes it, and refuses odd ids", () => {
    dir = mkdtempSync(join(tmpdir(), "couch-photos-"));
    const files = new PhotoFiles(join(dir, "wallpapers"));
    files.save("0123456789ab", Buffer.from("jpeg"));
    expect(readFileSync(join(dir, "wallpapers", "0123456789ab.jpg"), "utf8")).toBe("jpeg");
    expect(files.url("0123456789ab")).toMatch(/^file:\/\/\/.*\/wallpapers\/0123456789ab\.jpg$/);
    files.remove("0123456789ab");
    expect(existsSync(join(dir, "wallpapers", "0123456789ab.jpg"))).toBe(false);
    expect(() => files.save("../../etc/passwd", Buffer.from("x"))).toThrow();
    expect(() => files.url("a/b")).toThrow();
    expect(() => files.remove("..")).toThrow();
  });
});
