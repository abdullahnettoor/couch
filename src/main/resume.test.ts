import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { CommandName } from "../shared/protocol.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
const a = () => join(root, "Films", "A.Film.2001.mkv");
const b = () => join(root, "Films", "B.Film.2002.mkv");
const c = () => join(root, "Films", "C.Film.2003.mkv");
const d = () => join(root, "Other", "D.Show.mkv");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-resume-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-resume-store-"));
  mkdirSync(join(root, "Films"));
  mkdirSync(join(root, "Other"));
  for (const f of [a(), b(), c(), d()]) writeFileSync(f, "");
  new FileStore(storeDir).write("library", { folders: [root] });
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const start = async () => (h = await startHarness(new FileStore(storeDir)));
const core = () => h.app.core;
const press = (command: CommandName) => core().handle({ command }, "screen");
const screen = () => core().screen();
const loads = () => h.player.calls.filter((x) => x.call === "load");
const lastLoad = () => loads().at(-1)!.args as [string, { startSeconds?: number }];

/** Move focus to a tile by id with the D-pad. */
function focusOn(id: string) {
  for (let i = 0; i < 60 && screen().focusedId !== id; i++) {
    const { grid, focusedId } = screen();
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === id)!;
    press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(screen().focusedId).toBe(id);
}

/** Library → folders → open the video, then report its duration. */
function playFromLibrary(path: string, duration = 7200) {
  press("home");
  focusOn("library");
  press("ok");
  for (const id of [root, path.slice(0, path.lastIndexOf("/"))]) {
    focusOn(id);
    press("ok");
  }
  focusOn(path);
  press("ok");
  expect(screen().state.view).toBe("player");
  h.player.emit({ type: "duration", seconds: duration });
}

function position(seconds: number) {
  h.player.emit({ type: "position", seconds });
}

/** Play A to `seconds` and press Home. */
function watchAndLeave(path: string, seconds: number, duration = 7200) {
  playFromLibrary(path, duration);
  position(seconds);
  press("home");
}

describe("thresholds", () => {
  test("nothing is recorded in the first 60 s", async () => {
    await start();
    watchAndLeave(a(), 59);
    expect(screen().continueCard).toBeUndefined();
    watchAndLeave(a(), 60);
    expect(screen().continueCard?.title).toBe("A Film (2001)");
  });

  test("90% watched clears the position and tags the tile", async () => {
    await start();
    watchAndLeave(a(), 1000);
    watchAndLeave(a(), 6480); // 90% of 7200
    expect(screen().continueCard).toBeUndefined();
    playFromLibrary(a());
    expect(lastLoad()[1].startSeconds).toBeUndefined();
    press("home");
    press("home");
  });

  test("2 minutes or less left is watched", async () => {
    await start();
    watchAndLeave(a(), 880, 1000);
    expect(screen().continueCard).toBeUndefined();
    watchAndLeave(b(), 879, 1000);
    expect(screen().continueCard?.title).toBe("B Film (2002)");
  });

  test("watched tag shows on the tile and the video plays from the start", async () => {
    await start();
    watchAndLeave(a(), 7100);
    press("home");
    focusOn("library");
    press("ok");
    focusOn(root);
    press("ok");
    focusOn(join(root, "Films"));
    press("ok");
    const tile = screen().library!.entries.find((e) => e.path === a())!;
    expect(tile.watched).toBe(true);
    focusOn(a());
    press("ok");
    expect(lastLoad()[1].startSeconds).toBeUndefined();
  });
});

describe("saving", () => {
  test("every 5 s while playing, and killing loses at most 5 s", async () => {
    await start();
    playFromLibrary(a());
    position(100);
    h.clock.advance(5000);
    position(104);
    h.clock.advance(4000); // killed here: last save was at 100
    const store = new FileStore(storeDir);
    expect(store.read<any>("history", {}).items[a()].position).toBe(100);
    h.clock.advance(1000);
    expect(store.read<any>("history", {}).items[a()].position).toBe(104);
  });

  test("savePlayingPosition saves right now, and does nothing when idle", async () => {
    await start();
    core().savePlayingPosition();
    playFromLibrary(a());
    position(300);
    core().savePlayingPosition();
    expect(new FileStore(storeDir).read<any>("history", {}).items[a()].position).toBe(300);
  });

  test("Back, Home and Quit save", async () => {
    await start();
    playFromLibrary(a());
    position(200);
    press("back");
    expect(core().screen().continueCard?.progress?.left).toBe("117 min left");
    playFromLibrary(b());
    position(400);
    press("home");
    expect(new FileStore(storeDir).read<any>("history", {}).items[b()].position).toBe(400);
  });

  test("history survives a restart", async () => {
    await start();
    watchAndLeave(a(), 1200);
    await h.stop();
    await start();
    expect(screen().continueCard?.title).toBe("A Film (2001)");
  });
});

describe("resuming", () => {
  test("OK on an in-progress video passes start= and notes it", async () => {
    await start();
    watchAndLeave(a(), 2410);
    press("home");
    focusOn("library");
    press("ok");
    focusOn(root);
    press("ok");
    focusOn(join(root, "Films"));
    press("ok");
    focusOn(a());
    press("ok");
    expect(lastLoad()[1].startSeconds).toBe(2410);
    expect(h.player.overlay?.note).toBe("Resumed at 40:10");
    h.clock.advance(3100);
    expect(h.player.overlay?.note).toBeUndefined();
  });

  test("Home's card resumes the newest video", async () => {
    await start();
    watchAndLeave(a(), 600);
    h.clock.advance(1000);
    watchAndLeave(d(), 900);
    expect(screen().continueCard?.title).toBe("D Show");
    focusOn("continue");
    press("ok");
    expect(lastLoad()).toEqual([d(), { subtitles: true, startSeconds: 900 }]);
    expect(screen().state.view).toBe("player");
  });
});

describe("Continue watching lists", () => {
  test("Library row lists all, newest first; tiles show progress", async () => {
    await start();
    watchAndLeave(a(), 600);
    h.clock.advance(1000);
    watchAndLeave(d(), 900);
    h.clock.advance(1000);
    watchAndLeave(b(), 1800);
    press("home");
    focusOn("library");
    press("ok");
    const row = screen().library!.continueWatching!;
    expect(row.map((e) => e.path)).toEqual([b(), d(), a()]);
    expect(screen().continueCard?.path).toBe(b());
    expect(row[0]!.progress).toEqual({ fraction: 0.25, left: "90 min left" });
    expect(row[0]!.folder).toBe("Films");
    focusOn(root);
    press("ok");
    focusOn(join(root, "Films"));
    press("ok");
    const tile = screen().library!.entries.find((e) => e.path === a())!;
    expect(tile.progress?.left).toBe("110 min left");
  });

  test("a renamed file starts fresh; a deleted file disappears", async () => {
    await start();
    watchAndLeave(a(), 600);
    watchAndLeave(d(), 900);
    renameSync(a(), join(root, "Films", "A.Renamed.mkv"));
    expect(screen().continueCard?.path).toBe(d());
    expect(screen().library).toBeUndefined();
    rmSync(d());
    expect(screen().continueCard).toBeUndefined();
    playFromLibrary(join(root, "Films", "A.Renamed.mkv"));
    expect(lastLoad()[1].startSeconds).toBeUndefined();
  });
});

describe("end of file", () => {
  test("marks watched, returns to the folder, focuses the next video, no autoplay", async () => {
    await start();
    playFromLibrary(a());
    position(3000);
    const before = loads().length;
    h.player.emit({ type: "ended", reason: "eof" });
    expect(screen().state.view).toBe("folder");
    expect(screen().focusedId).toBe(b());
    expect(loads().length).toBe(before);
    expect(screen().library!.entries.find((e) => e.path === a())!.watched).toBe(true);
    expect(screen().continueCard).toBeUndefined();
  });

  test("resuming from Home ends in the video's folder", async () => {
    await start();
    watchAndLeave(c(), 600);
    focusOn("continue");
    press("ok");
    h.player.emit({ type: "ended", reason: "eof" });
    expect(screen().state.view).toBe("folder");
    expect(screen().focusedId).toBe(c());
  });
});
