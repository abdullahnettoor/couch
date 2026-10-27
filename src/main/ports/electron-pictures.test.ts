import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({ createFromBuffer: vi.fn() }));
vi.mock("electron", () => ({ nativeImage: native }));

import { ElectronConverter } from "./electron-pictures.ts";
import { imageSize, MAX_PIXELS, MAX_SIDE } from "./pictures.ts";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), 8 + data.length);
  return out;
};

/** A few dozen bytes that declare a huge picture: all-zero rows deflate to almost nothing. */
export const pngDeclaring = (width: number, height: number) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(64))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

export const jpegDeclaring = (width: number, height: number, sof = 0xc0) => {
  const app0 = Buffer.from([
    0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const frame = Buffer.from([
    0xff,
    sof,
    0,
    17,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame, Buffer.from([0xff, 0xd9])]);
};

describe("imageSize reads the header only", () => {
  test("JPEG baseline and progressive, after other segments", () => {
    expect(imageSize(jpegDeclaring(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(imageSize(jpegDeclaring(640, 480, 0xc2))).toEqual({ width: 640, height: 480 });
  });
  test("PNG IHDR", () => {
    expect(imageSize(pngDeclaring(3000, 2000))).toEqual({ width: 3000, height: 2000 });
  });
  test("truncated or odd headers give undefined", () => {
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(imageSize(jpegDeclaring(10, 10).subarray(0, 24))).toBeUndefined();
    expect(imageSize(pngDeclaring(10, 10).subarray(0, 20))).toBeUndefined();
    expect(imageSize(Buffer.from("GIF89a"))).toBeUndefined();
  });
});

describe("ElectronConverter refuses decoding bombs and non-pictures before decoding", () => {
  let dir = "";
  beforeEach(() => {
    native.createFromBuffer.mockReset();
    dir = mkdtempSync(join(tmpdir(), "couch-conv-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const converter = () => new ElectronConverter(join(dir, "wallpapers"));
  const file = (bytes: Buffer | string, name = "a.jpg") => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };

  test.each([
    ["a JPEG 65535 px wide", jpegDeclaring(65535, 100)],
    ["a JPEG 65535 × 65535", jpegDeclaring(65535, 65535)],
    ["a JPEG just over the side limit", jpegDeclaring(MAX_SIDE + 1, 10)],
    ["a PNG 100000 px tall", pngDeclaring(10, 100000)],
    ["a PNG 60000 × 60000", pngDeclaring(60000, 60000)],
    ["a JPEG under the side limit but over 40 megapixels", jpegDeclaring(8000, 6000)],
    ["a PNG over 40 megapixels", pngDeclaring(7000, 7000)],
    ["a JPEG with zero size", jpegDeclaring(0, 0)],
    ["a JPEG with no readable size", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2])],
    ["a text file", Buffer.from("not a picture at all")],
    ["a GIF", Buffer.from("GIF89a\x01\x00\x01\x00")],
  ])("%s", async (_name, bytes) => {
    expect(bytes.length).toBeLessThan(200);
    expect(await converter().convert(file(bytes))).toBeUndefined();
    expect(native.createFromBuffer).not.toHaveBeenCalled();
  });

  test("a folder and a missing file are refused", async () => {
    expect(await converter().convert(dir)).toBeUndefined();
    expect(await converter().convert(join(dir, "nope.jpg"))).toBeUndefined();
  });

  test("a picture within the limits does reach the decoder", async () => {
    native.createFromBuffer.mockReturnValue({ isEmpty: () => true });
    expect(await converter().convert(file(jpegDeclaring(MAX_SIDE, 4000)))).toBeUndefined();
    expect(native.createFromBuffer).toHaveBeenCalledOnce();
    expect(MAX_PIXELS).toBe(40_000_000);
  });

  test("the source file is only read: its bytes and modification time stay as they were", async () => {
    native.createFromBuffer.mockReturnValue({ isEmpty: () => true });
    const path = file(jpegDeclaring(100, 100));
    const before = statSync(path);
    await converter().convert(path);
    const after = statSync(path);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(readFileSync(path).equals(jpegDeclaring(100, 100))).toBe(true);
  });
});
