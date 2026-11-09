import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { ElectronConverter } from "./electron-pictures.ts";
import { imageSize, MAX_SIDE, readBmp } from "./pictures.ts";

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

type Rgb = [number, number, number];
type Grid = Rgb[][];

/** A PNG of rows of pixels (8-bit RGB). */
const pngOf = (grid: Grid) => {
  const h = grid.length;
  const w = grid[0]!.length;
  const rows = Buffer.concat(grid.map((row) => Buffer.from([0, ...row.flat()])));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
/** A big flat picture without a grid of 18 million pixels in memory: one row of bytes, repeated. */
/** What converting a 6000 × 3000 picture may cost this process: reading, checking and copying it, never decoding it. */
const MAX_OWN_CPU_MS = 200;
const solidPng = (w: number, h: number, rgb: Rgb = [200, 80, 40]) => {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)), { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const solid = (w: number, h: number, rgb: Rgb = [200, 80, 40]): Grid =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => rgb));

const RED: Rgb = [220, 30, 30];
const GREEN: Rgb = [30, 200, 30];
const BLUE: Rgb = [30, 30, 220];
const WHITE: Rgb = [240, 240, 240];
/** 80 × 40, four flat quadrants: the way up is unmistakable. */
const upright = (): Grid =>
  Array.from({ length: 40 }, (_, y) =>
    Array.from({ length: 80 }, (_, x) => (y < 20 ? (x < 40 ? RED : GREEN) : x < 40 ? BLUE : WHITE)),
  );
const flipH = (g: Grid): Grid => g.map((r) => [...r].reverse());
const flipV = (g: Grid): Grid => [...g].reverse();
const cw = (g: Grid): Grid => g[0]!.map((_, x) => g.map((row) => row[x]!).reverse());
const ccw = (g: Grid): Grid => g[0]!.map((_, x) => g.map((row) => row[row.length - 1 - x]!));
const transpose = (g: Grid): Grid => g[0]!.map((_, x) => g.map((row) => row[x]!));
/** The picture as the camera stored it, for an EXIF orientation: showing it upright takes the inverse. */
const stored = (o: number): Grid => {
  const g = upright();
  return (
    {
      1: g,
      2: flipH(g),
      3: flipV(flipH(g)),
      4: flipV(g),
      5: transpose(g),
      6: ccw(g),
      7: flipV(flipH(transpose(g))),
      8: cw(g),
    } as Record<number, Grid>
  )[o]!;
};

/** Puts an EXIF block (orientation, plus a marker string standing in for GPS) right after the JFIF header. */
const withExif = (jpeg: Buffer, orientation: number) => {
  const tiff = Buffer.alloc(26);
  tiff.write("MM");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const body = Buffer.concat([Buffer.from("Exif\0\0"), tiff, Buffer.from("GPSLatitude-51.5074N")]);
  const seg = Buffer.alloc(4);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(body.length + 2, 2);
  const parts: Buffer[] = [];
  let at = 2;
  while (jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    const length = jpeg.readUInt16BE(at + 2);
    if (jpeg[at + 1] !== 0xe1) parts.push(jpeg.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    parts[0]!,
    seg,
    body,
    ...parts.slice(1),
    jpeg.subarray(at),
  ]);
};

describe("ElectronConverter", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "couch-conv-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const work = () => join(dir, "wallpapers");
  const converter = (run?: ConstructorParameters<typeof ElectronConverter>[1]) =>
    new ElectronConverter(work(), run);
  const file = (bytes: Buffer | string, name = "a.jpg") => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  };
  /** A real JPEG through `sips`, from a PNG of the grid. */
  const jpegOf = (grid: Grid, name = "src.jpg") => {
    const png = file(pngOf(grid), `${name}.png`);
    const out = join(dir, name);
    execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", png, "--out", out], { stdio: "ignore" });
    return readFileSync(out);
  };
  /** Decodes a converted JPEG back to pixels (with `sips`, outside Couch's code). */
  const decode = (jpeg: Buffer, size = 0) => {
    const jpg = file(jpeg, "out.jpg");
    const bmp = join(dir, "out.bmp");
    const args = ["-s", "format", "bmp", ...(size ? ["-z", String(size), String(size)] : [])];
    execFileSync("/usr/bin/sips", [...args, jpg, "--out", bmp], { stdio: "ignore" });
    return readBmp(readFileSync(bmp))!;
  };
  const sizeOf = (jpeg: Buffer) => imageSize(jpeg)!;

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
  ])("refuses %s before decoding", async (_name, bytes) => {
    const calls: string[][] = [];
    const out = await converter(async (_f, args) => {
      calls.push(args);
      return "";
    }).convert(file(bytes));
    expect(out).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("a folder and a missing file are refused", async () => {
    expect(await converter().convert(dir)).toBeUndefined();
    expect(await converter().convert(join(dir, "nope.jpg"))).toBeUndefined();
  });

  test("a real PNG becomes a JPEG, with a thumbnail and a brightness; nothing is left in the work folder", async () => {
    const src = file(pngOf(solid(200, 100, [250, 250, 250])), "a.png");
    const before = readFileSync(src);
    const out = (await converter().convert(src))!;
    expect(sizeOf(out.jpeg)).toEqual({ width: 200, height: 100 });
    expect(sizeOf(out.thumb)).toEqual({ width: 200, height: 100 });
    expect(out.brightness).toBeGreaterThan(0.9);
    expect(readdirSync(work())).toEqual([]);
    expect(readFileSync(src).equals(before)).toBe(true);
  });

  test("EXIF, GPS included, is gone from the output", async () => {
    const src = file(withExif(jpegOf(upright()), 1), "gps.jpg");
    expect(readFileSync(src).includes("GPSLatitude")).toBe(true);
    const out = (await converter().convert(src))!;
    expect(out.jpeg.includes("GPSLatitude")).toBe(false);
    expect(out.jpeg.includes("Exif")).toBe(false);
    expect(out.thumb.includes("Exif")).toBe(false);
  });

  describe("orientation: the picture comes out upright", () => {
    test.each([
      [1, "upright"],
      [2, "mirrored"],
      [3, "upside down"],
      [4, "mirrored vertically"],
      [5, "transposed"],
      [6, "turned right"],
      [7, "transversed"],
      [8, "turned left"],
    ])("orientation %i (%s)", async (o) => {
      const src = file(withExif(jpegOf(stored(o)), o), `o${o}.jpg`);
      const out = (await converter().convert(src))!;
      expect(sizeOf(out.jpeg)).toEqual({ width: 80, height: 40 });
      const px = decode(out.jpeg);
      const near = (at: [number, number], want: Rgb) => {
        const got = px.pixel(at[0], at[1]);
        for (const i of [0, 1, 2]) expect(Math.abs(got[i]! - want[i]!)).toBeLessThan(45);
      };
      near([20, 10], RED);
      near([60, 10], GREEN);
      near([20, 30], BLUE);
      near([60, 30], WHITE);
    });
  });

  describe("the TV size cap applies when either side is over 3840 × 2160", () => {
    test("100 × 2161 is scaled down to a height of 2160", async () => {
      const out = (await converter().convert(file(pngOf(solid(100, 2161)), "tall.png")))!;
      const { width, height } = sizeOf(out.jpeg);
      expect(height).toBe(2160);
      expect(Math.abs(width / height - 100 / 2161)).toBeLessThan(0.002);
    });
    test("4000 × 100 is scaled down to a width of 3840", async () => {
      const out = (await converter().convert(file(pngOf(solid(4000, 100)), "wide.png")))!;
      expect(sizeOf(out.jpeg)).toEqual({ width: 3840, height: 96 });
    });
    test("a picture within the box is not enlarged or resized", async () => {
      const out = (await converter().convert(file(pngOf(solid(3840, 2160)), "fit.png")))!;
      expect(sizeOf(out.jpeg)).toEqual({ width: 3840, height: 2160 });
    });
  });

  describe("the source is opened once, and what was opened is what was listed", () => {
    const listed = (path: string) => {
      const st = statSync(path);
      return { size: st.size, dev: st.dev, ino: st.ino };
    };

    test("the file as listed is converted", async () => {
      const src = file(pngOf(solid(40, 20)), "ok.png");
      expect(await converter().convert(src, listed(src))).toBeDefined();
    });

    test("a queued file swapped for a symlink is refused, and the symlink's target is never read", async () => {
      const src = file(pngOf(solid(40, 20)), "queued.png");
      const expect_ = listed(src);
      const secret = file(pngOf(solid(40, 20, [1, 2, 3])), "secret.png");
      rmSync(src);
      symlinkSync(secret, src);
      expect(await converter().convert(src, expect_)).toBeUndefined();
      expect(await converter().convert(src)).toBeUndefined();
    });

    test("a queued file replaced by another file is refused", async () => {
      const src = file(pngOf(solid(40, 20)), "queued.png");
      const expect_ = listed(src);
      const other = file(pngOf(solid(40, 20, [9, 9, 9])), "other.png");
      renameSync(other, src);
      expect(await converter().convert(src, expect_)).toBeUndefined();
    });

    test("a file whose size changed since it was listed is refused", async () => {
      const src = file(pngOf(solid(40, 20)), "grown.png");
      const expect_ = listed(src);
      writeFileSync(src, Buffer.concat([readFileSync(src), Buffer.alloc(10)]));
      expect(await converter().convert(src, expect_)).toBeUndefined();
    });

    test("`sips` only ever sees copies in the work folder, never the source path", async () => {
      const src = file(pngOf(solid(40, 20)), "src.png");
      const seen: string[] = [];
      const real = (await import("node:child_process")).execFile;
      const out = await converter((f, args) => {
        seen.push(...args);
        return new Promise((resolve, reject) =>
          real(f, args, (err, o) => (err ? reject(err) : resolve(o))),
        );
      }).convert(src);
      expect(out).toBeDefined();
      const paths = seen.filter((a) => a.startsWith("/"));
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.some((p) => p === src)).toBe(false);
      expect(paths.every((p) => p.startsWith(work()) || p.startsWith("/usr/bin"))).toBe(true);
    });
  });

  test("a real HEIC converts, and an upright orientation is kept", async () => {
    const png = file(pngOf(upright()), "h.png");
    const heic = join(dir, "h.heic");
    execFileSync("/usr/bin/sips", ["-s", "format", "heic", png, "--out", heic], {
      stdio: "ignore",
    });
    const out = (await converter().convert(heic))!;
    expect(sizeOf(out.jpeg)).toEqual({ width: 80, height: 40 });
    const px = decode(out.jpeg);
    expect(px.pixel(20, 10)[0]).toBeGreaterThan(150);
    expect(px.pixel(20, 30)[2]).toBeGreaterThan(150);
  });

  test("the conversion does not block the event loop", async () => {
    const src = file(solidPng(6000, 3000), "big.png");
    // CPU time, not a timer's lateness: on a loaded machine the whole process is descheduled and a timer runs late
    // whatever the code does, but CPU time counts only work done here. The decoding is `sips`'s, in a child process
    // that this does not count; a converter that decoded the picture itself would spend seconds of CPU on it.
    const before = process.cpuUsage();
    const out = await converter().convert(src);
    const { user, system } = process.cpuUsage(before);
    expect(out).toBeDefined();
    expect((user + system) / 1000).toBeLessThan(MAX_OWN_CPU_MS);
  }, 30_000);

  test("the source file is only read: its bytes and modification time stay as they were", async () => {
    const path = file(pngOf(solid(40, 20)), "keep.png");
    const bytes = readFileSync(path);
    const before = statSync(path);
    await converter().convert(path);
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
    expect(readFileSync(path).equals(bytes)).toBe(true);
  });
});
