import { describe, expect, it } from "vite-plus/test";
import { collectLibs, isSystemRef, resolveRef, rewritePlan, type LibInfo } from "./bundle-libs.mts";

// A fake filesystem of dylibs: path -> what `otool` would report.
const fake = (libs: Record<string, LibInfo>, links: Record<string, string> = {}) => ({
  inspect: (file: string) => {
    const info = libs[file];
    if (!info) throw new Error(`no such lib ${file}`);
    return info;
  },
  exists: (file: string) => file in libs || file in links,
  realpath: (file: string) => links[file] ?? file,
});

describe("isSystemRef", () => {
  it("is true for /usr/lib and /System, false for Homebrew and relative refs", () => {
    expect(isSystemRef("/usr/lib/libz.1.dylib")).toBe(true);
    expect(isSystemRef("/System/Library/Frameworks/IOKit.framework/Versions/A/IOKit")).toBe(true);
    expect(isSystemRef("/opt/homebrew/opt/ffmpeg/lib/libavutil.61.dylib")).toBe(false);
    expect(isSystemRef("@rpath/libfoo.dylib")).toBe(false);
  });
});

describe("resolveRef", () => {
  const exists = (f: string) => f === "/b/lib/libx.dylib";
  it("returns absolute refs unchanged", () => {
    expect(resolveRef("/opt/homebrew/lib/a.dylib", "/a", [], exists)).toBe(
      "/opt/homebrew/lib/a.dylib",
    );
  });
  it("resolves @loader_path against the loading file's directory", () => {
    expect(resolveRef("@loader_path/../lib/libx.dylib", "/b/bin", [], exists)).toBe(
      "/b/lib/libx.dylib",
    );
  });
  it("resolves @rpath through the rpaths, first existing wins, expanding @loader_path", () => {
    expect(resolveRef("@rpath/libx.dylib", "/b/lib", ["/nope", "@loader_path"], exists)).toBe(
      "/b/lib/libx.dylib",
    );
  });
  it("throws when an @rpath ref can't be found", () => {
    expect(() => resolveRef("@rpath/libgone.dylib", "/b", ["/nope"], exists)).toThrow(/libgone/);
  });
});

describe("collectLibs", () => {
  it("collects transitive dependencies once, skipping system libraries", () => {
    const sys = "/usr/lib/libSystem.B.dylib";
    const libs = {
      "/h/mpv/libmpv.2.dylib": {
        deps: ["/h/ff/libav.dylib", "/h/ass/libass.dylib", sys],
        rpaths: [],
      },
      "/h/ff/libav.dylib": { deps: ["/h/util/libutil.dylib", sys], rpaths: [] },
      "/h/ass/libass.dylib": { deps: ["/h/util/libutil.dylib", sys], rpaths: [] },
      "/h/util/libutil.dylib": { deps: [sys], rpaths: [] },
    };
    const got = collectLibs("/h/mpv/libmpv.2.dylib", fake(libs));
    expect(got.map((l) => l.name).sort()).toEqual([
      "libass.dylib",
      "libav.dylib",
      "libmpv.2.dylib",
      "libutil.dylib",
    ]);
  });
  it("handles dependency cycles", () => {
    const libs = {
      "/h/a.dylib": { deps: ["/h/b.dylib"], rpaths: [] },
      "/h/b.dylib": { deps: ["/h/a.dylib"], rpaths: [] },
    };
    expect(collectLibs("/h/a.dylib", fake(libs)).map((l) => l.name)).toEqual([
      "a.dylib",
      "b.dylib",
    ]);
  });
  it("follows symlinks: two names for one file are one library, named by the real file", () => {
    const libs = {
      "/h/a.dylib": { deps: ["/opt/x/lib/libz.1.dylib", "/opt/x/lib/libz.dylib"], rpaths: [] },
      "/Cellar/x/1/lib/libz.1.2.dylib": { deps: [], rpaths: [] },
    };
    const links = {
      "/opt/x/lib/libz.1.dylib": "/Cellar/x/1/lib/libz.1.2.dylib",
      "/opt/x/lib/libz.dylib": "/Cellar/x/1/lib/libz.1.2.dylib",
    };
    const got = collectLibs("/h/a.dylib", fake(libs, links));
    expect(got.map((l) => l.name)).toEqual(["a.dylib", "libz.1.2.dylib"]);
    expect(got[1].realPath).toBe("/Cellar/x/1/lib/libz.1.2.dylib");
  });
  it("resolves @rpath and @loader_path dependencies", () => {
    const libs = {
      "/h/a/liba.dylib": {
        deps: ["@rpath/libb.dylib", "@loader_path/libc.dylib"],
        rpaths: ["/h/b"],
      },
      "/h/b/libb.dylib": { deps: [], rpaths: [] },
      "/h/a/libc.dylib": { deps: [], rpaths: [] },
    };
    expect(collectLibs("/h/a/liba.dylib", fake(libs)).map((l) => l.name)).toEqual([
      "liba.dylib",
      "libb.dylib",
      "libc.dylib",
    ]);
  });
  it("refuses two different libraries with the same file name", () => {
    const libs = {
      "/h/a.dylib": { deps: ["/x/libq.dylib", "/y/libq.dylib"], rpaths: [] },
      "/x/libq.dylib": { deps: [], rpaths: [] },
      "/y/libq.dylib": { deps: [], rpaths: [] },
    };
    expect(() => collectLibs("/h/a.dylib", fake(libs))).toThrow(/libq.dylib/);
  });
});

describe("rewritePlan", () => {
  it("gives each library a @loader_path id and points every non-system ref at its sibling", () => {
    const sys = "/usr/lib/libSystem.B.dylib";
    const libs = {
      "/h/mpv/libmpv.2.dylib": { deps: ["/opt/x/lib/libz.1.dylib", sys], rpaths: [] },
      "/Cellar/x/1/lib/libz.1.2.dylib": { deps: [sys], rpaths: [] },
    };
    const links = { "/opt/x/lib/libz.1.dylib": "/Cellar/x/1/lib/libz.1.2.dylib" };
    const plan = rewritePlan(collectLibs("/h/mpv/libmpv.2.dylib", fake(libs, links)));
    expect(plan).toEqual([
      {
        name: "libmpv.2.dylib",
        id: "@loader_path/libmpv.2.dylib",
        changes: [["/opt/x/lib/libz.1.dylib", "@loader_path/libz.1.2.dylib"]],
        deleteRpaths: [],
      },
      { name: "libz.1.2.dylib", id: "@loader_path/libz.1.2.dylib", changes: [], deleteRpaths: [] },
    ]);
  });
  it("deletes the rpaths, so nothing points back at Homebrew", () => {
    const libs = {
      "/h/a/liba.dylib": { deps: ["@rpath/libb.dylib"], rpaths: ["/h/b"] },
      "/h/b/libb.dylib": { deps: [], rpaths: [] },
    };
    const plan = rewritePlan(collectLibs("/h/a/liba.dylib", fake(libs)));
    expect(plan[0].changes).toEqual([["@rpath/libb.dylib", "@loader_path/libb.dylib"]]);
    expect(plan[0].deleteRpaths).toEqual(["/h/b"]);
  });
});
