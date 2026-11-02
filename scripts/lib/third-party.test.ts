import { describe, expect, it } from "vite-plus/test";
import { isLicenceFile, kegOf, renderManifest } from "./third-party.mts";

describe("kegOf", () => {
  it("reads the formula, version and keg folder from a Cellar path", () => {
    expect(kegOf("/opt/homebrew/Cellar/ffmpeg/9.0.2_1/lib/libavcodec.63.1.102.dylib")).toEqual({
      formula: "ffmpeg",
      version: "9.0.2_1",
      dir: "/opt/homebrew/Cellar/ffmpeg/9.0.2_1",
    });
  });
  it("is undefined outside a Cellar", () => {
    expect(kegOf("/usr/local/lib/libfoo.dylib")).toBeUndefined();
  });
});

describe("isLicenceFile", () => {
  it("matches the usual licence file names and nothing else", () => {
    for (const name of [
      "LICENSE",
      "LICENSE.md",
      "COPYING.GPLv3",
      "COPYING.LGPLv2.1",
      "COPYRIGHT",
      "NOTICE",
      "LGPL-2.1-or-later.txt",
    ])
      expect(isLicenceFile(name)).toBe(true);
    for (const name of [
      "README.md",
      "Changelog",
      "INSTALL_RECEIPT.json",
      "sbom.spdx.json",
      "NEWS",
      "notes.txt",
    ])
      expect(isLicenceFile(name)).toBe(false);
  });
});

describe("renderManifest", () => {
  it("lists each library with its version, licence, source and the libraries it supplies", () => {
    const md = renderManifest([
      {
        formula: "zimg",
        version: "3.0.6",
        license: "WTFPL",
        source: "https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz",
        libraries: ["libzimg.2.dylib"],
        licenceFiles: ["COPYING"],
      },
    ]);
    expect(md).toContain("| zimg | 3.0.6 | WTFPL |");
    expect(md).toContain(
      "https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz",
    );
    expect(md).toContain("libzimg.2.dylib");
    expect(md).toContain("licenses/zimg/COPYING");
  });
  it("says so when a licence is unknown rather than leaving it blank", () => {
    const md = renderManifest([
      {
        formula: "x",
        version: "1",
        license: undefined,
        source: "",
        libraries: ["libx.dylib"],
        licenceFiles: [],
      },
    ]);
    expect(md).toContain("| x | 1 | unknown |");
  });
});
