import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { planLicences, REQUIRED_LICENCE_FILES } from "./licences.mts";

describe("planLicences", () => {
  it("fails for a keg that only has an overview pointing at texts it doesn't ship", () => {
    expect(() => planLicences("freetype", ["LICENSE.TXT", "README"], [])).toThrow(/FTL\.TXT/);
  });
  it("passes once the vendored texts are there, listing keg files and vendored files", () => {
    expect(planLicences("freetype", ["LICENSE.TXT"], ["FTL.TXT", "GPLv2.TXT"])).toEqual([
      { name: "LICENSE.TXT", from: "keg" },
      { name: "FTL.TXT", from: "vendored" },
      { name: "GPLv2.TXT", from: "vendored" },
    ]);
  });
  it("fails when a bundled formula has no licence text at all", () => {
    expect(() => planLicences("zimg", ["README.md", "sbom.spdx.json"], [])).toThrow(
      /zimg.*no licence/,
    );
  });
  it("passes a formula whose keg has its text and needs nothing else", () => {
    expect(planLicences("zimg", ["COPYING", "README.md"], [])).toEqual([
      { name: "COPYING", from: "keg" },
    ]);
  });
  it("fails when a file the keg should supply is missing", () => {
    expect(() => planLicences("pcre2", ["COPYING"], [])).toThrow(/LICENCE\.md/);
    expect(planLicences("pcre2", ["COPYING", "LICENCE.md"], [])).toHaveLength(2);
  });
  it("takes the required list as a parameter", () => {
    expect(() => planLicences("foo", ["COPYING"], [], { foo: ["EXTRA"] })).toThrow(/EXTRA/);
  });
});

describe("the vendored licence folder", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "licenses");
  it("has every file it holds listed as required, so packaging can't ship a stale one", () => {
    for (const formula of readdirSync(root).filter((n) => existsSync(join(root, n, ".")))) {
      if (formula.endsWith(".md")) continue;
      for (const file of readdirSync(join(root, formula)))
        expect(REQUIRED_LICENCE_FILES[formula]).toContain(file);
    }
  });
  it("holds the texts the kegs lack", () => {
    for (const [formula, file] of [
      ["freetype", "FTL.TXT"],
      ["freetype", "GPLv2.TXT"],
      ["lz4", "LICENSE-lib"],
      ["jpeg-turbo", "README.ijg"],
      ["gettext", "COPYING.LIB"],
    ])
      expect(existsSync(join(root, formula, file))).toBe(true);
  });
});
