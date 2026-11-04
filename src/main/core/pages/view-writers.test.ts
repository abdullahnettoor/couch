import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = /\bstate\.view\s*=[^=]/;

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
        ? [join(dir, e.name)]
        : [],
  );

test("only Core.#setView writes state.view", () => {
  const writers = files(CORE).flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, i) => (WRITE.test(line) ? [`${file}:${i + 1}`] : []));
  });
  expect(writers).toHaveLength(1);
  expect(writers[0]).toContain(join(CORE, "core.ts"));
  const source = readFileSync(join(CORE, "core.ts"), "utf8");
  const setView = source.slice(source.indexOf("  #setView(view: View)"));
  expect(setView.slice(0, setView.indexOf("\n  }\n"))).toMatch(WRITE);
});
