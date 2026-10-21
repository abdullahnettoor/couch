import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-vol-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-volstore-"));
  mkdirSync(join(root, "Movies"));
  writeFileSync(join(root, "Movies", "Dune.2021.mkv"), "");
  new FileStore(storeDir).write("library", { folders: [root] });
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

describe("phone volume slider", () => {
  test.each([
    ["home", async () => {}],
    ["youtube", async (p: { press: (c: "ok") => Promise<unknown> }) => void (await p.press("ok"))],
  ] as const)(
    "volSet in the %s layout reaches Couch's volume and every phone",
    async (layout, go) => {
      h = await startHarness(new FileStore(storeDir));
      const a = await h.connectPhone();
      const b = await h.connectPhone();
      await go(a);
      const s = await a.press({ command: "volSet", args: { percent: 72 } });
      expect(s.layout).toBe(layout);
      expect(h.player.calls.at(-1)).toEqual({ call: "setVolume", args: [72] });
      await b.waitFor(() => b.last?.volume === 72);
      expect(a.last!.volume).toBe(72);
    },
  );

  test("volSet in the Now Playing layout reaches Couch's volume and every phone", async () => {
    h = await startHarness(new FileStore(storeDir));
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    for (const c of ["right", "ok", "ok", "ok", "ok"] as const) await a.press(c);
    expect(a.last!.layout).toBe("player");
    await a.press({ command: "volSet", args: { percent: 33 } });
    expect(h.player.calls.at(-1)).toEqual({ call: "setVolume", args: [33] });
    await b.waitFor(() => b.last?.volume === 33);
  });
});
