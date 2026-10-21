import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { CommandName } from "../shared/protocol.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

const MIN = 60_000;
let root: string;
let storeDir: string;
let h: Harness;
let phone: Awaited<ReturnType<Harness["connectPhone"]>>;
const a = () => join(root, "Films", "A.Film.2001.mkv");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-calm-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-calm-store-"));
  mkdirSync(join(root, "Films"));
  writeFileSync(a(), "");
  new FileStore(storeDir).write("library", { folders: [root] });
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const screen = () => h.app.screen();
const press = (c: CommandName) => h.app.screenCommand({ command: c });

async function start(inProgress = true) {
  h = await startHarness(new FileStore(storeDir));
  phone = await h.connectPhone();
  if (!inProgress) return;
  for (const id of ["library", root, join(root, "Films"), a()]) {
    for (let i = 0; i < 20 && screen().focusedId !== id; i++) {
      const cur = screen().grid.find((x) => x.id === screen().focusedId)!;
      const t = screen().grid.find((x) => x.id === id)!;
      press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
    }
    press("ok");
  }
  h.player.emit({ type: "duration", seconds: 7200 });
  h.player.emit({ type: "position", seconds: 600 });
  press("home");
}

describe("calm Home", () => {
  test("opens on YouTube with no hero, then a focused film shows it", async () => {
    await start();
    expect(screen().focusedId).toBe("youtube");
    expect(screen().hero).toBeUndefined();
    press("right");
    press("right");
    expect(screen().focusedId).toBe(a());
    expect(screen().hero?.path).toBe(a());
    press("left");
    expect(screen().hero).toBeUndefined();
  });

  test("nothing in progress: idle Home, no hero", async () => {
    await start(false);
    expect(screen().hero).toBeUndefined();
    expect(screen().focusedId).toBe("youtube");
  });

  test("returning from a video started on Home focuses its card", async () => {
    await start();
    press("right");
    press("right");
    press("ok");
    press("back");
    expect(screen().state.view).toBe("home");
    expect(screen().focusedId).toBe(a());
    expect(screen().hero?.path).toBe(a());
  });
});

describe("ambient mode", () => {
  test("after 2 minutes idle on Home, not before", async () => {
    await start(false);
    h.clock.advance(2 * MIN - 1000);
    expect(screen().ambient).toBe(false);
    h.clock.advance(1000);
    expect(screen().ambient).toBe(true);
    expect(h.screen.last.ambient).toBe(true);
  });

  test("the first input only wakes it; focus stays", async () => {
    await start();
    press("right");
    h.clock.advance(2 * MIN);
    expect(screen().ambient).toBe(true);
    await phone.press("right");
    expect(screen().ambient).toBe(false);
    expect(screen().focusedId).toBe("library");
    await phone.press("right");
    expect(screen().focusedId).toBe(a());
    h.clock.advance(2 * MIN);
    expect(screen().ambient).toBe(true);
  });

  test("not in other views", async () => {
    await start(false);
    press("ok");
    h.clock.advance(5 * MIN);
    expect(screen().state.view).toBe("app");
    expect(screen().ambient).toBe(false);
  });

  test("not while a video plays", async () => {
    await start();
    press("right");
    press("right");
    press("ok");
    h.clock.advance(5 * MIN);
    expect(screen().ambient).toBe(false);
  });
});

describe("12/24-hour time", () => {
  test("follows the Mac port and changes live", async () => {
    await start(false);
    expect(screen().timeFormat).toBe("12");
    h.mac.setTimeFormat("24");
    expect(h.screen.last.timeFormat).toBe("24");
    h.mac.setTimeFormat("12");
    expect(h.screen.last.timeFormat).toBe("12");
  });
});
