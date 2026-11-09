import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { rulesBlurringOnlyWithPrefix } from "./built-css-blur.ts";

describe("built CSS keeps the unprefixed backdrop-filter", () => {
  it("flags a rule with only the -webkit- blur", () => {
    expect(rulesBlurringOnlyWithPrefix(".a{-webkit-backdrop-filter:var(--b);inset:0}")).toEqual([
      ".a",
    ]);
  });
  it("accepts both, only the standard one, and a prefixed none", () => {
    expect(
      rulesBlurringOnlyWithPrefix(
        ".a{-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px)}.b{backdrop-filter:blur(1px)}.c{-webkit-backdrop-filter:none}",
      ),
    ).toEqual([]);
  });
  // The built Screen itself is checked by `pnpm glass:fade` after `vp build` (CI runs both); a stale local
  // `dist/` must not fail the unit tests, so here the source is held to the rule that keeps the build right.
  it("the Screen's CSS never writes -webkit-backdrop-filter itself (the build adds it)", () => {
    const dir = join(import.meta.dirname, "../src/renderer");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".css"))
      .filter((f) => /-webkit-backdrop-filter/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
