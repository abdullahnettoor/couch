// Pixel comparison for the screenshot harness (look-snap.mts): a small PNG codec, the comparison and the folder diff.
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Rgba {
  width: number;
  height: number;
  /** width × height × 4 bytes, rows top to bottom. */
  data: Uint8Array;
}

/**
 * A pixel differs when any colour channel is more than this far (out of 255) from the baseline's.
 * That absorbs the 1-2 level noise from text anti-aliasing and the blur's rounding; any visible change to a colour, size or position is far above it.
 */
export const DEFAULT_TOLERANCE = 4;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, body: Uint8Array) => {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  out.set(body, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};

export function encodePng({ width, height, data }: Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** Reads an 8-bit RGB or RGBA PNG (what Electron writes). */
export function decodePng(file: Uint8Array): Rgba {
  const buf = Buffer.from(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 4;
  const parts: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || (colour !== 6 && colour !== 2) || interlace !== 0)
        throw new Error("only 8-bit RGB or RGBA PNGs are supported");
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") parts.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) data[(y * width + x) * 4 + c] = line[x * channels + c];
      data[(y * width + x) * 4 + 3] = channels === 4 ? line[x * 4 + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data };
}

/** Whether the whole picture is one colour: a capture of a page that drew nothing. */
export function isBlank({ data }: Rgba): boolean {
  for (let i = 4; i < data.length; i += 4)
    if (
      data[i] !== data[0] ||
      data[i + 1] !== data[1] ||
      data[i + 2] !== data[2] ||
      data[i + 3] !== data[3]
    )
      return false;
  return true;
}

export interface Comparison {
  differing: number;
  sizeMismatch: boolean;
  /** The head picture dimmed, with every differing pixel in red. */
  diff: Rgba;
}

export function compareImages(
  base: Rgba,
  head: Rgba,
  { tolerance = DEFAULT_TOLERANCE } = {},
): Comparison {
  const sizeMismatch = base.width !== head.width || base.height !== head.height;
  const width = Math.max(base.width, head.width);
  const height = Math.max(base.height, head.height);
  const diff: Rgba = { width, height, data: new Uint8Array(width * height * 4) };
  let differing = 0;
  const pixel = (img: Rgba, x: number, y: number) =>
    x < img.width && y < img.height
      ? img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)
      : undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = pixel(base, x, y);
      const b = pixel(head, x, y);
      const out = (y * width + x) * 4;
      const changed = !a || !b || [0, 1, 2, 3].some((c) => Math.abs(a[c] - b[c]) > tolerance);
      if (changed) {
        differing++;
        diff.data.set([255, 0, 0, 255], out);
      } else {
        for (let c = 0; c < 3; c++) diff.data[out + c] = Math.round(b![c] * 0.3);
        diff.data[out + 3] = 255;
      }
    }
  }
  return { differing, sizeMismatch, diff };
}

export interface FolderDiff {
  compared: number;
  differing: Array<{ name: string; pixels: number; sizeMismatch: boolean }>;
  missingInHead: string[];
  missingInBase: string[];
}

const pngs = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();

/** Compares same-named PNGs in two folders, writing a diff image into `outDir` for each that differs. */
export function diffFolders(
  baseDir: string,
  headDir: string,
  { outDir, tolerance }: { outDir?: string; tolerance?: number } = {},
): FolderDiff {
  const base = pngs(baseDir);
  const head = pngs(headDir);
  const result: FolderDiff = {
    compared: 0,
    differing: [],
    missingInHead: base.filter((f) => !head.includes(f)),
    missingInBase: head.filter((f) => !base.includes(f)),
  };
  for (const name of base.filter((f) => head.includes(f))) {
    result.compared++;
    const r = compareImages(
      decodePng(readFileSync(join(baseDir, name))),
      decodePng(readFileSync(join(headDir, name))),
      { tolerance },
    );
    if (r.differing === 0) continue;
    result.differing.push({ name, pixels: r.differing, sizeMismatch: r.sizeMismatch });
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, name), encodePng(r.diff));
    }
  }
  return result;
}
