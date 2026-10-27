import { describe, expect, test } from "vite-plus/test";
import {
  WALLPAPERS,
  dimFor,
  photoVars,
  resolveChoice,
  resolveWallpaper,
  wallpaperVars,
} from "./wallpapers.ts";

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

describe("built-in wallpapers", () => {
  test("six wallpapers, Couch first", () => {
    expect(WALLPAPERS.map((w) => w.id)).toEqual([
      "couch",
      "dusk",
      "ocean",
      "forest",
      "ember",
      "graphite",
    ]);
  });

  test("an unknown or malformed value falls back to Couch", () => {
    expect(resolveWallpaper({ kind: "builtin", id: "nope" }).id).toBe("couch");
    expect(resolveWallpaper(undefined).id).toBe("couch");
    expect(resolveWallpaper("dusk").id).toBe("couch");
    expect(resolveWallpaper({ kind: "builtin", id: "ember" }).id).toBe("ember");
  });

  test("each wallpaper sets its own background variables and a slow drift", () => {
    const seen = new Set<string>();
    for (const w of WALLPAPERS) {
      const vars = wallpaperVars(w.id);
      expect(vars["--wp-base"]).toContain("radial-gradient");
      expect(vars["--wp-glow"]).toContain("radial-gradient");
      expect(Number.parseFloat(vars["--wp-drift"]!)).toBeGreaterThanOrEqual(90);
      seen.add(vars["--wp-base"]! + vars["--wp-glow"]!);
    }
    expect(seen.size).toBe(WALLPAPERS.length);
  });

  test("every wallpaper is dark, near-black at the edge and with a faint glow", () => {
    for (const w of WALLPAPERS) {
      expect(luminance(w.core), w.id).toBeLessThanOrEqual(0.035);
      expect(luminance(w.mid), w.id).toBeLessThanOrEqual(0.012);
      expect(luminance(w.edge), w.id).toBeLessThanOrEqual(0.003);
      for (const [, , , alpha] of w.glow) expect(alpha, w.id).toBeLessThanOrEqual(0.16);
    }
  });
});

describe("photo wallpapers", () => {
  test("dim runs from 35% for a black photo to 65% for a white one", () => {
    expect(dimFor(0)).toBeCloseTo(0.35);
    expect(dimFor(1)).toBeCloseTo(0.65);
    expect(dimFor(0.5)).toBeCloseTo(0.5);
    expect(dimFor(-3)).toBeCloseTo(0.35);
    expect(dimFor(7)).toBeCloseTo(0.65);
    expect(dimFor(Number.NaN)).toBeCloseTo(0.65);
  });

  test("a stored photo choice is kept only while that photo exists", () => {
    const photos = [{ id: "aaaaaaaaaaaa" }];
    expect(resolveChoice({ kind: "photo", id: "aaaaaaaaaaaa" }, photos)).toEqual({
      kind: "photo",
      id: "aaaaaaaaaaaa",
    });
    expect(resolveChoice({ kind: "photo", id: "bbbbbbbbbbbb" }, photos)).toEqual({
      kind: "builtin",
      id: "couch",
    });
    expect(resolveChoice({ kind: "photo", id: "aaaaaaaaaaaa" }, [])).toEqual({
      kind: "builtin",
      id: "couch",
    });
    expect(resolveChoice({ kind: "builtin", id: "dusk" }, photos)).toEqual({
      kind: "builtin",
      id: "dusk",
    });
    expect(resolveChoice({ kind: "builtin", id: "nope" }, photos)).toEqual({
      kind: "builtin",
      id: "couch",
    });
  });

  test("a photo sets its picture and dim variables", () => {
    expect(photoVars({ id: "a", url: "file:///u/wallpapers/a.jpg", dim: 0.5 })).toEqual({
      "--wp-photo": 'url("file:///u/wallpapers/a.jpg")',
      "--wp-dim": "0.5",
    });
  });
});
