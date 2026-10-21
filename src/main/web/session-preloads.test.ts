import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { SessionPreloads } from "./session-preloads.ts";

function setup() {
  const live = new Map<string, string>();
  let n = 0;
  const ses = {
    registerPreloadScript: (s: { type: "frame"; filePath: string }) => {
      const id = `p${++n}`;
      live.set(id, s.filePath);
      return id;
    },
    unregisterPreloadScript: (id: string) => void live.delete(id),
  };
  const dir = mkdtempSync(join(tmpdir(), "couch-preloads-"));
  return { ses, live, preloads: new SessionPreloads(ses, dir, "youtube") };
}

describe("session preloads", () => {
  test("nothing is registered while the list is empty", () => {
    expect(setup().live.size).toBe(0);
  });

  test("functions run in the main world, in list order, from one file", () => {
    const { preloads, live } = setup();
    preloads.add("first", "function () { window.a = 1; }");
    preloads.add("second", "function () { window.b = 2; }");
    expect(live.size).toBe(1);
    const file = readFileSync([...live.values()][0]!, "utf8");
    expect(file).toContain("executeInMainWorld");
    expect(file.indexOf("window.a")).toBeLessThan(file.indexOf("window.b"));
  });

  test("a change re-registers: the old registration is dropped", () => {
    const { preloads, live } = setup();
    preloads.add("first", "function () {}");
    const before = [...live.keys()][0];
    preloads.add("second", "function () {}");
    expect(live.size).toBe(1);
    expect([...live.keys()][0]).not.toBe(before);
  });

  test("a failure to write logs and leaves the page unpatched", () => {
    const logs: string[] = [];
    const ses = { registerPreloadScript: () => "x", unregisterPreloadScript: () => {} };
    const p = new SessionPreloads(ses, "/dev/null/nope", "youtube", (m) => logs.push(m));
    p.add("4k", "function () {}");
    expect(logs[0]).toContain("4k");
  });
});
