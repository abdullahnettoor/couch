import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  compareImages,
  decodePng,
  diffFolders,
  encodePng,
  isBlank,
  type Rgba,
} from "./look-diff.ts";

const image = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set([...fill(x, y), 255], (y * w + x) * 4);
  return { width: w, height: h, data } satisfies Rgba;
};
const grey = (v: number) => () => [v, v, v] as [number, number, number];

describe("PNG round trip", () => {
  test("decoding what was encoded gives the same pixels", () => {
    const img = image(7, 5, (x, y) => [x * 30, y * 40, (x * y) % 256]);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(7);
    expect(back.height).toBe(5);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });
});

describe("compareImages", () => {
  test("identical images differ in no pixel", () => {
    const a = image(4, 4, grey(100));
    expect(compareImages(a, a).differing).toBe(0);
  });

  test("counts the pixels that changed and marks them in the diff image", () => {
    const a = image(4, 4, grey(100));
    const b = image(4, 4, (x, y) => (x === 1 && y === 2 ? [200, 100, 100] : [100, 100, 100]));
    const r = compareImages(a, b);
    expect(r.differing).toBe(1);
    const at = (x: number, y: number) =>
      Array.from(r.diff.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 3));
    expect(at(1, 2)).toEqual([255, 0, 0]);
    expect(at(0, 0)).not.toEqual([255, 0, 0]);
  });

  test("a difference within the anti-aliasing tolerance is not a difference", () => {
    const a = image(3, 3, grey(100));
    expect(compareImages(a, image(3, 3, grey(104))).differing).toBe(0);
    expect(compareImages(a, image(3, 3, grey(105))).differing).toBe(9);
    expect(compareImages(a, image(3, 3, grey(110)), { tolerance: 10 }).differing).toBe(0);
  });

  test("images of different sizes differ completely", () => {
    const r = compareImages(image(3, 3, grey(0)), image(4, 3, grey(0)));
    expect(r.sizeMismatch).toBe(true);
    expect(r.differing).toBeGreaterThan(0);
  });
});

describe("isBlank", () => {
  test("a single colour is blank; any other pixel makes it not", () => {
    expect(isBlank(image(5, 5, grey(30)))).toBe(true);
    expect(isBlank(image(5, 5, (x, y) => (x === 4 && y === 4 ? [31, 30, 30] : [30, 30, 30])))).toBe(
      false,
    );
  });
});

describe("diffFolders", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const folder = (files: Record<string, Rgba>) => {
    const dir = mkdtempSync(join(tmpdir(), "look-diff-"));
    dirs.push(dir);
    for (const [name, img] of Object.entries(files)) writeFileSync(join(dir, name), encodePng(img));
    return dir;
  };

  test("0 images differ for the same pictures", () => {
    const files = { "a.png": image(4, 4, grey(10)), "b.png": image(4, 4, grey(20)) };
    const r = diffFolders(folder(files), folder(files));
    expect(r.differing).toEqual([]);
    expect(r.compared).toBe(2);
  });

  test("lists each image that differs, writes a diff image for it, and names missing ones", () => {
    const base = folder({
      "a.png": image(4, 4, grey(10)),
      "b.png": image(4, 4, grey(20)),
      "gone.png": image(2, 2, grey(0)),
    });
    const head = folder({
      "a.png": image(4, 4, grey(10)),
      "b.png": image(4, 4, grey(90)),
      "new.png": image(2, 2, grey(0)),
    });
    const out = join(head, "diff");
    mkdirSync(out);
    const r = diffFolders(base, head, { outDir: out });
    expect(r.differing.map((d) => d.name)).toEqual(["b.png"]);
    expect(r.missingInHead).toEqual(["gone.png"]);
    expect(r.missingInBase).toEqual(["new.png"]);
    expect(existsSync(join(out, "b.png"))).toBe(true);
    expect(existsSync(join(out, "a.png"))).toBe(false);
    expect(decodePng(readFileSync(join(out, "b.png"))).width).toBe(4);
  });
});
