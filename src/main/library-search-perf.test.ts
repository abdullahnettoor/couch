import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-searchperf-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-searchperfstore-"));
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test("a keystroke on a household-sized Library (≈150 titles, ≈500 episodes) is quick", async () => {
  const touch = (...parts: string[]) => {
    const p = join(root, ...parts);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "");
  };
  for (let f = 0; f < 100; f++) touch(`Film ${f} Panda (${2000 + (f % 24)}).mkv`);
  for (let s = 0; s < 50; s++)
    for (let e = 1; e <= 10; e++)
      touch(`Show ${s}`, "Season 1", `Show ${s} S01E${String(e).padStart(2, "0")}.mkv`);
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store, { tmdbProjectKey: "eyJ.test.key" });
  for (let s = 0; s < 50; s++) {
    h.metadata.catalog.show[`show ${s}`] = [{ id: 1000 + s, name: `Show ${s}`, year: 2020 }];
    h.metadata.detailsById.set(1000 + s, {
      id: 1000 + s,
      name: `Show ${s}`,
      seasons: [
        {
          number: 1,
          episodes: Array.from({ length: 10 }, (_, i) => ({
            number: i + 1,
            name: `Chapter ${i + 1} of the Panda story`,
          })),
        },
      ],
    } as never);
  }
  await h.app.core.library.settled();
  await h.app.core.details.settled();
  const phone = await h.connectPhone();
  await phone.press("home");
  for (let i = 0; i < 40 && h.screen.last.focusedId !== "library"; i++) {
    const { grid, focusedId } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === "library")!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  await phone.press("ok");
  await phone.press("typeOpen");
  const text = "panda story";
  const start = performance.now();
  for (let i = 1; i <= text.length; i++) {
    await phone.press({ command: "typeText", args: { text: text.slice(0, i) } });
    h.clock.advance(150);
  }
  const each = (performance.now() - start) / text.length;
  console.log(`search keystroke: ${each.toFixed(1)} ms`);
  expect(h.screen.last.search!.rows.length).toBeGreaterThan(0);
  expect(each).toBeLessThan(150);
});
