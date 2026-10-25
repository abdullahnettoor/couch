import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const native = join(import.meta.dirname, "../../../native/mpv-embed");
const hasCompiler = process.platform === "darwin";

// The ordering rule lives in native/mpv-embed/view_order.h (the add-on keeps it in native code), so its
// test is a C++ program against a fake window: video < glass < web contents after visibility changes,
// resizes and new web views, with Electron's reorders fed in through the injectable change source.
describe.skipIf(!hasCompiler)("native view ordering (view_order.h)", () => {
  it("keeps video < glass < web contents through every kind of host reorder", () => {
    const dir = mkdtempSync(join(tmpdir(), "view-order-"));
    try {
      const exe = join(dir, "view_order_test");
      execFileSync("c++", ["-std=c++17", "-Wall", "-o", exe, join(native, "view_order_test.cc")]);
      expect(execFileSync(exe, { encoding: "utf8" }).trim()).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
