import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { builtCssBlurOffenders, rulesBlurringOnlyWithPrefix } from "./built-css-blur.ts";

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
  it.skipIf(!existsSync(join(import.meta.dirname, "../dist/renderer")))(
    "holds for every rule in the built Screen (needs `vp build`)",
    () => {
      expect(builtCssBlurOffenders(join(import.meta.dirname, "../dist/renderer"))).toEqual([]);
    },
  );
});
