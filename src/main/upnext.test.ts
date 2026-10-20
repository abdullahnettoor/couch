import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness, type FakePhone } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;
const ep = (n: number) => join(root, "Show", `Show S01E0${n}.mkv`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-up-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-upstore-"));
  mkdirSync(join(root, "Show", "Extras"), { recursive: true });
  for (const n of [1, 2, 3]) writeFileSync(ep(n), "");
  writeFileSync(join(root, "Show", "notes.txt"), "");
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const calls = (name: string) => h.player.calls.filter((c) => c.call === name);
const overlay = () => h.screen.last.overlay!;
const focusedTitle = () => {
  const i = overlay().upNext!.focusedIndex!;
  return overlay().upNext!.tiles[i]!.title;
};

/** Home → Library → library folder → Show → E01 playing. */
async function playE01() {
  h = await startHarness(
    (() => {
      const store = new FileStore(storeDir);
      store.write("library", { folders: [root] });
      return store;
    })(),
  );
  phone = await h.connectPhone();
  await phone.press("right");
  await phone.press("ok");
  await phone.press("ok");
  await phone.press("ok"); // Show
  await phone.press("right"); // past Extras
  await phone.press("ok"); // E01
  h.player.emit({ type: "duration", seconds: 600 });
}

describe("Up next", () => {
  test("lists the folder's videos in order, with the playing one marked and focused", async () => {
    await playE01();
    h.clock.advance(4600);
    expect(overlay().upNext).toBeUndefined();
    await phone.press("down");
    expect(h.screen.last.state.controls).toBe("upnext");
    expect(overlay().upNext!.tiles.map((t) => [t.title, t.playing])).toEqual([
      ["Show S01E01", true],
      ["Show S01E02", false],
      ["Show S01E03", false],
    ]);
    expect(focusedTitle()).toBe("Show S01E01");
    expect(overlay().dock!.upNext).toBe(true);
  });

  test("Left/Right move along the row without seeking; Back closes it to the dock", async () => {
    await playE01();
    await phone.press("down");
    await phone.press("right");
    expect(focusedTitle()).toBe("Show S01E02");
    expect(calls("seekTo")).toHaveLength(0);
    await phone.press("back");
    expect(h.screen.last.state.controls).toBe("dock");
    expect(overlay().upNext).toBeUndefined();
    expect(overlay().dock!.focusedId).toBe("upnext");
    expect(h.screen.last.state.view).toBe("player");
  });

  test("the dock's Up next button is reachable and OK on it goes up into the row", async () => {
    await playE01();
    await phone.press("down");
    await phone.press("down");
    expect(overlay().dock!.focusedId).toBe("upnext");
    await phone.press("back");
    expect(h.screen.last.state.controls).toBe("dock");
    await phone.press("ok");
    expect(h.screen.last.state.controls).toBe("upnext");
    expect(focusedTitle()).toBe("Show S01E01");
  });

  test("subtitles are raised higher while the row shows", async () => {
    await playE01();
    await phone.press("down");
    expect(calls("setSubtitlesRaised").at(-1)!.args).toEqual([true, true]);
    await phone.press("back");
    expect(calls("setSubtitlesRaised").at(-1)!.args).toEqual([true, false]);
  });

  test("it stays open while nothing is pressed", async () => {
    await playE01();
    await phone.press("down");
    h.clock.advance(20000);
    expect(h.screen.last.state.controls).toBe("upnext");
  });

  test("OK on another episode plays it, and Back returns to the folder where E01 was started", async () => {
    await playE01();
    h.clock.advance(300);
    h.player.emit({ type: "position", seconds: 120 });
    await phone.press("down");
    await phone.press("right");
    await phone.press("ok");
    expect(calls("load").at(-1)!.args[0]).toBe(ep(2));
    expect(h.screen.last.state.controls).toBe("dock");
    expect(h.screen.last.state.player!.path).toBe(ep(2));
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("folder");
    expect(h.screen.last.state.folderPath).toBe(join(root, "Show"));
  });

  test("the chosen episode resumes, and the one left behind keeps its position", async () => {
    await playE01();
    h.player.emit({ type: "position", seconds: 120 });
    await phone.press("down");
    await phone.press("right");
    await phone.press("ok");
    h.player.emit({ type: "duration", seconds: 600 });
    h.player.emit({ type: "position", seconds: 300 });
    await phone.press("down");
    await phone.press("left");
    await phone.press("ok");
    const last = calls("load").at(-1)!;
    expect(last.args[0]).toBe(ep(1));
    expect(last.args[1]).toMatchObject({ startSeconds: 120 });
    await phone.press("down");
    const tiles = overlay().upNext!.tiles;
    expect(tiles[1]!.progress).toBeCloseTo(0.5);
  });

  test("watched videos are flagged", async () => {
    await playE01();
    h.player.emit({ type: "position", seconds: 598 });
    h.player.emit({ type: "ended", reason: "eof" });
    await phone.settle();
    await phone.press("ok"); // focus moved on to E02
    expect(calls("load").at(-1)!.args[0]).toBe(ep(2));
    await phone.press("down");
    expect(overlay().upNext!.tiles.map((t) => t.watched)).toEqual([true, false, false]);
  });

  test("tiles carry the picture once it exists", async () => {
    await playE01();
    await phone.press("down");
    expect(h.thumbnails.started).toContain(ep(2));
    h.thumbnails.finish(ep(2));
    await phone.settle();
    expect(overlay().upNext!.tiles[1]!.thumb).toContain("file:///thumbs/");
  });
});

describe("Up next from a phone", () => {
  test("the snapshot carries it only while playing, with keys and no paths", async () => {
    await playE01();
    h.thumbnails.cache.set(ep(2), "file:///cache/abc123.jpg");
    const snap = await phone.press("playpause");
    expect(snap.upNext).toEqual([
      { title: "Show S01E01", watched: false, playing: true },
      { title: "Show S01E02", thumbKey: "abc123", watched: false, playing: false },
      { title: "Show S01E03", watched: false, playing: false },
    ]);
    expect(JSON.stringify(snap)).not.toContain(root);
    await phone.press("back");
    expect(phone.last!.upNext).toBeUndefined();
  });

  test("playUpNext plays the right one; refused out of range, off the player, or with a path", async () => {
    await playE01();
    await phone.press({ command: "playUpNext", args: { index: 2 } });
    expect(calls("load").at(-1)!.args[0]).toBe(ep(3));
    const n = calls("load").length;
    phone.send({ command: "playUpNext", args: { index: 3 } });
    phone.send({ command: "playUpNext", args: { index: -1 } });
    phone.send({ command: "playUpNext", args: { path: ep(1) } } as never);
    await phone.settle();
    expect(calls("load")).toHaveLength(n);
    await phone.press("back");
    phone.send({ command: "playUpNext", args: { index: 0 } });
    await phone.settle();
    expect(calls("load")).toHaveLength(n);
    expect(phone.last!.view).toBe("folder");
  });
});
