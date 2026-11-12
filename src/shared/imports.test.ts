import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

describe("src/shared", () => {
  it("imports nothing from src/main", () => {
    const offenders = readdirSync(import.meta.dirname, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) =>
        /from\s+["'](\.\.\/)+main\//.test(readFileSync(join(import.meta.dirname, f), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
