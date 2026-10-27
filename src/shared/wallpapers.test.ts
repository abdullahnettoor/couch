import { describe, expect, test } from "vite-plus/test";
import {
  WALLPAPERS,
  dimFor,
  parseChoice,
  photoVars,
  tidyName,
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

describe("pictures from the Mac", () => {
  test("dim runs from 35% for a black picture to 65% for a white one", () => {
    expect(dimFor(0)).toBeCloseTo(0.35);
    expect(dimFor(1)).toBeCloseTo(0.65);
    expect(dimFor(0.5)).toBeCloseTo(0.5);
    expect(dimFor(-3)).toBeCloseTo(0.35);
    expect(dimFor(7)).toBeCloseTo(0.65);
    expect(dimFor(Number.NaN)).toBeCloseTo(0.65);
  });

  test("a stored choice is read as one of the four kinds; anything odd becomes Couch", () => {
    expect(parseChoice({ kind: "mac" })).toEqual({ kind: "mac" });
    expect(parseChoice({ kind: "folder", file: "a.jpg" })).toEqual({
      kind: "folder",
      file: "a.jpg",
    });
    expect(parseChoice({ kind: "apple", file: "Mac Blue.heic" })).toEqual({
      kind: "apple",
      file: "Mac Blue.heic",
    });
    expect(parseChoice({ kind: "builtin", id: "dusk" })).toEqual({ kind: "builtin", id: "dusk" });
    const couch = { kind: "builtin", id: "couch" };
    for (const odd of [
      undefined,
      null,
      "mac",
      { kind: "photo", id: "aaaaaaaaaaaa" },
      { kind: "folder" },
      { kind: "folder", file: "../etc/passwd" },
      { kind: "folder", file: "a/b.jpg" },
      { kind: "apple", file: ".." },
      { kind: "apple", file: 4 },
      { kind: "builtin", id: "nope" },
    ])
      expect(parseChoice(odd), JSON.stringify(odd)).toEqual(couch);
  });

  test("a file name becomes a tidy tile label", () => {
    expect(tidyName("Mac Blue.heic")).toBe("Mac Blue");
    expect(tidyName("_Desert Sands_ by Louis Coyle.heic")).toBe("Desert Sands by Louis Coyle");
    expect(tidyName("dramatic-scenery-3840x2160-20802.jpg")).toBe("Dramatic scenery");
    expect(tidyName("MacInternals_Dark.png")).toBe("MacInternals Dark");
    expect(tidyName("material-style-8k-2880x1800.jpeg")).toBe("Material style 8k");
    expect(tidyName("2024.png")).toBe("2024");
    expect(tidyName("...")).toBe("...");
  });

  test("a picture sets its picture and dim variables", () => {
    expect(photoVars({ url: "file:///u/wallpapers/a.jpg", dim: 0.5 })).toEqual({
      "--wp-photo": 'url("file:///u/wallpapers/a.jpg")',
      "--wp-dim": "0.5",
    });
  });
});
