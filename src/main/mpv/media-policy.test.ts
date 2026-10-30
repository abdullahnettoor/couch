import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const native = join(import.meta.dirname, "../../../native/mpv-embed");

// The native media-key rules live in native/mpv-embed/media_policy.h: what Start registers, delivery through the thread-safe
// callback, stop and restart, and presses queued after a stop being dropped. The test is a C++ program against a fake centre.
describe.skipIf(process.platform !== "darwin")("native media-key policy (media_policy.h)", () => {
  it("delivers presses through Start's callback, releases on stop and drops stale presses", () => {
    const dir = mkdtempSync(join(tmpdir(), "media-policy-"));
    try {
      const exe = join(dir, "media_policy_test");
      execFileSync("c++", ["-std=c++17", "-Wall", "-o", exe, join(native, "media_policy_test.cc")]);
      expect(execFileSync(exe, { encoding: "utf8" }).trim()).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
