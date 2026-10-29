import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const native = join(import.meta.dirname, "../../../native/mpv-embed");

// The native input rules live in native/mpv-embed/input_policy.h: which keys are held back, the host's
// acknowledgement and deadline, key-up pairing, and who owns a mouse press. The test is a C++ program against fakes.
describe.skipIf(process.platform !== "darwin")("native input policy (input_policy.h)", () => {
  it("holds, acknowledges, recovers and pairs keys, and keeps each view's mouse ownership", () => {
    const dir = mkdtempSync(join(tmpdir(), "input-policy-"));
    try {
      const exe = join(dir, "input_policy_test");
      execFileSync("c++", ["-std=c++17", "-Wall", "-o", exe, join(native, "input_policy_test.cc")]);
      expect(execFileSync(exe, { encoding: "utf8" }).trim()).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
