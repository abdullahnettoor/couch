import { describe, expect, it } from "vite-plus/test";
import { compareVersions, nextVersion, parseVersion, withVersion } from "./release-version.mts";

describe("nextVersion", () => {
  it("bumps patch, minor and major", () => {
    expect(nextVersion("0.1.1", "patch")).toBe("0.1.2");
    expect(nextVersion("0.1.1", "minor")).toBe("0.2.0");
    expect(nextVersion("0.1.1", "major")).toBe("1.0.0");
  });
  it("from a pre-release, releases it rather than skipping past it", () => {
    expect(nextVersion("0.2.0-beta.1", "patch")).toBe("0.2.0");
    expect(nextVersion("0.2.0-beta.1", "minor")).toBe("0.2.0");
    expect(nextVersion("1.0.0-rc.1", "major")).toBe("1.0.0");
    expect(nextVersion("0.2.1-beta.1", "minor")).toBe("0.3.0");
  });
  it("takes an exact version, with or without v", () => {
    expect(nextVersion("0.1.1", "0.2.0-beta.1")).toBe("0.2.0-beta.1");
    expect(nextVersion("0.2.0-beta.1", "v0.2.0-beta.2")).toBe("0.2.0-beta.2");
  });
  it("refuses a version that isn't newer, or isn't SemVer", () => {
    expect(() => nextVersion("0.1.1", "0.1.1")).toThrow("isn't newer");
    expect(() => nextVersion("0.1.1", "0.1.0")).toThrow("isn't newer");
    expect(() => nextVersion("0.2.0", "0.2.0-beta.1")).toThrow("isn't newer");
    expect(() => nextVersion("0.1.1", "next")).toThrow("isn't patch, minor, major");
    expect(() => nextVersion("0.1.1", "1.2")).toThrow("isn't patch, minor, major");
  });
});

describe("compareVersions", () => {
  it("orders versions as SemVer does", () => {
    const sorted = [
      "1.0.0",
      "0.10.0",
      "0.2.0",
      "0.2.0-rc.1",
      "0.2.0-beta.11",
      "0.2.0-beta.2",
      "0.2.0-beta",
      "0.2.0-alpha",
      "0.2.0-1",
    ];
    expect([...sorted].reverse().sort(compareVersions).reverse()).toEqual(sorted);
  });
  it("rejects what isn't SemVer", () => {
    expect(parseVersion("01.0.0")).toBeUndefined();
    expect(() => compareVersions("1.0", "1.0.0")).toThrow("not a SemVer version: 1.0");
  });
});

describe("withVersion", () => {
  it("changes only the top-level version", () => {
    const pkg = `{\n  "name": "couch",\n  "version": "0.1.1",\n  "devEngines": {\n    "packageManager": {\n      "version": "12.14.0"\n    }\n  }\n}\n`;
    expect(withVersion(pkg, "0.1.2")).toBe(pkg.replace('"0.1.1"', '"0.1.2"'));
  });
});
