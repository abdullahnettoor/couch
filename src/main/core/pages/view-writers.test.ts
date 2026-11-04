import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(CORE, "..");

/** Every way to write the view that a line can show: assignment, Object.assign, spread, bracket and destructuring writes. */
const WRITES: Array<[string, RegExp]> = [
  ["assignment", /\bstate\.view\s*(?:[-+*/%&|^]|\*\*|&&|\|\||\?\?|<<|>>>?)?=[^=]/],
  ["bracket assignment", /\bstate\s*\[\s*["'`]view["'`]\s*\]\s*=[^=]/],
  ["Object.assign", /Object\.assign\(\s*(?:this\.)?#?(?:state|ctx\.state)\b/],
  ["spread into state", /\.\.\.\s*(?:this\.)?#?state\b[^.]/],
  ["defineProperty", /Object\.defineProperty\(\s*(?:this\.)?#?state\b/],
];

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
        ? [join(dir, e.name)]
        : [],
  );

const hits = (kinds: string[]) =>
  files(CORE).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) =>
        WRITES.some(([kind, re]) => kinds.includes(kind) && re.test(line))
          ? [`${file.slice(MAIN.length + 1)}:${i + 1}: ${line.trim()}`]
          : [],
      ),
  );

test("only Core.#setView writes state.view", () => {
  const writers = hits(["assignment", "bracket assignment"]);
  expect(writers).toHaveLength(1);
  expect(writers[0]).toContain("core/core.ts");
  const source = readFileSync(join(CORE, "core.ts"), "utf8");
  const setView = source.slice(source.indexOf("  #setView(view: View"));
  expect(setView.slice(0, setView.indexOf("\n  }\n"))).toMatch(WRITES[0]![1]);
});

test("nothing in src/main/core writes the view through Object.assign, a spread or a defineProperty", () => {
  expect(hits(["Object.assign", "spread into state", "defineProperty"])).toEqual([]);
});

test("the checks catch each way of writing the view", () => {
  const shown: Array<[string, string]> = [
    ["assignment", "this.#state.view = view;"],
    ["assignment", 'ctx.state.view ??= "home";'],
    ["bracket assignment", 'this.#state["view"] = "home";'],
    ["Object.assign", 'Object.assign(this.#state, { view: "home" });'],
    ["Object.assign", "Object.assign(ctx.state, patch);"],
    ["spread into state", "this.#state = { ...this.#state, ...patch };"],
    ["defineProperty", 'Object.defineProperty(this.#state, "view", { value: "home" });'],
  ];
  for (const [kind, line] of shown)
    expect(
      WRITES.some(([k, re]) => k === kind && re.test(line)),
      `${kind}: ${line}`,
    ).toBe(true);
});
