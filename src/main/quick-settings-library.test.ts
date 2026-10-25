import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { CommandName } from "../shared/protocol.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
const film = () => join(root, "Films", "A.Film.2001.mkv");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-quick-lib-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-quick-lib-store-"));
  mkdirSync(join(root, "Films"));
  writeFileSync(film(), "");
  new FileStore(storeDir).write("library", { folders: [root] });
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const press = (command: CommandName) => h.app.screenCommand({ command });
const screen = () => h.app.screen();

function focusOn(id: string) {
  for (let i = 0; i < 60 && screen().focusedId !== id; i++) {
    const { grid, focusedId } = screen();
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === id)!;
    press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(screen().focusedId).toBe(id);
}

describe("Quick settings → All settings during Library playback", () => {
  test("ends the playback like Back does: stops the player, saves the position, and the arrows stop driving it", async () => {
    h = await startHarness(new FileStore(storeDir));
    press("home");
    focusOn("library");
    press("ok");
    for (const id of [root, join(root, "Films"), film()]) {
      focusOn(id);
      press("ok");
    }
    expect(screen().state.view).toBe("player");
    h.player.emit({ type: "duration", seconds: 7200 });
    h.player.emit({ type: "position", seconds: 900 });
    h.player.calls.length = 0;

    press("quickSettings");
    while (screen().quick?.focusedId !== "settings") press("down");
    press("ok");

    expect(screen().state.view).toBe("settings");
    expect(screen().quick).toBeUndefined();
    expect(h.player.calls.some((c) => c.call === "stop")).toBe(true);
    expect(screen().playing).toBe(false);
    expect(screen().continueCard?.title).toBe("A Film (2001)");

    h.player.calls.length = 0;
    for (const k of ["down", "right", "ok"] as const) press(k);
    expect(
      h.player.calls.filter((c) => ["seek", "pause", "playPause", "setPaused"].includes(c.call)),
    ).toEqual([]);
  });
});
