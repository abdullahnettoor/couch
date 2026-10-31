import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

describe("userData folder", () => {
  test("is named from the app name, not the bundle id", () => {
    const main = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(main).toContain('app.setName("Couch")');
    expect(main).not.toMatch(/setPath\(\s*["']userData/);
  });
});
