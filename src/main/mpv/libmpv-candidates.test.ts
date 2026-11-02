import { expect, test } from "vite-plus/test";
import { libmpvCandidates } from "./embed-addon.ts";

const bundled = "/Applications/Couch.app/Contents/Frameworks/mpv/libmpv.2.dylib";
const resources = "/Applications/Couch.app/Contents/Resources";

test("tries COUCH_LIBMPV first, then the bundled copy", () => {
  expect(libmpvCandidates({ COUCH_LIBMPV: "/dev/libmpv.dylib" }, resources, () => true)).toEqual([
    "/dev/libmpv.dylib",
    bundled,
  ]);
});

test("uses just the bundled copy when there is no override", () => {
  expect(libmpvCandidates({}, resources, () => true)).toEqual([bundled]);
});

test("leaves it to Homebrew (the add-on's own list) when nothing is bundled, as in a source run", () => {
  expect(libmpvCandidates({}, "/repo/node_modules/electron/Resources", () => false)).toEqual([]);
});
