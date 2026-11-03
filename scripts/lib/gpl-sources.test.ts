import { describe, expect, it } from "vite-plus/test";
import { cachedName, currentKegVersion, isBottle, manifestFormulae } from "./gpl-sources.mts";
import { renderManifest } from "./third-party.mts";

describe("manifestFormulae", () => {
  it("reads every row of the manifest the packager writes", () => {
    const manifest = renderManifest([
      {
        formula: "mpv",
        version: "0.41.0_2",
        license: "GPL-2.0-or-later",
        source: "https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz",
        pins: ["sha256 abc"],
        patches: [],
        extraSources: [],
        libraries: ["libmpv.2.dylib"],
        licenceFiles: ["LICENSE.GPL"],
      },
      {
        formula: "x264",
        version: "r3222",
        license: undefined,
        source: "https://code.videolan.org/videolan/x264.git",
        pins: ["revision 31e19f9"],
        patches: [],
        extraSources: [],
        libraries: ["libx264.165.dylib"],
        licenceFiles: [],
      },
    ]);
    expect(manifestFormulae(manifest)).toEqual([
      { formula: "mpv", version: "0.41.0_2" },
      { formula: "x264", version: "r3222" },
    ]);
  });
});

describe("currentKegVersion", () => {
  it("adds Homebrew's revision suffix only when there is one", () => {
    expect(currentKegVersion({ versions: { stable: "0.17.5" }, revision: 0 })).toBe("0.17.5");
    expect(currentKegVersion({ versions: { stable: "9.0.2" }, revision: 1 })).toBe("9.0.2_1");
  });
});

describe("cached downloads", () => {
  it("drops the hash Homebrew puts before a cached file's name", () => {
    expect(
      cachedName(
        "109672c8255db68b49961a9528bfcf8cdea6d8e122888237201e9513699e6d0f--libass-0.17.5.tar.xz",
      ),
    ).toBe("libass-0.17.5.tar.xz");
    expect(cachedName("x264--git")).toBe("x264--git");
  });
  it("tells bottles from sources", () => {
    expect(isBottle("0410--molten-vk--1.4.2.arm64_tahoe.bottle.tar.gz")).toBe(true);
    expect(isBottle("05cf--libvpx--1.17.0.arm64_tahoe.bottle.1.tar.gz")).toBe(true);
    expect(isBottle("070305--ca-certificates-2026-10-20.bottle_manifest.json")).toBe(true);
    expect(isBottle("109672--libass-0.17.5.tar.xz")).toBe(false);
    expect(isBottle("0e73e2--libass.rb")).toBe(false);
  });
});
