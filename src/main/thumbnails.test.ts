import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { FfmpegThumbnails, findFfmpeg, thumbnailKey } from "./ports/thumbnails.ts";
import { startHarness, type Harness } from "./testing/harness.ts";
import { spawnSync } from "node:child_process";

describe("thumbnailKey", () => {
  test("changes with size or modified time, stable otherwise", () => {
    const k = thumbnailKey("/a.mkv", 10, 1000);
    expect(thumbnailKey("/a.mkv", 10, 1000)).toBe(k);
    expect(thumbnailKey("/a.mkv", 11, 1000)).not.toBe(k);
    expect(thumbnailKey("/a.mkv", 10, 2000)).not.toBe(k);
    expect(thumbnailKey("/b.mkv", 10, 1000)).not.toBe(k);
  });
});

let root: string;
let storeDir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-th-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-thstore-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

describe("thumbnails through the Remote", () => {
  let h: Harness;
  afterEach(() => h?.stop());
  const entries = () => h.screen.last.library!.entries;
  const names = ["a", "b", "c", "d"];
  const path = (n: string) => join(root, `${n}.mkv`);

  async function openRoot() {
    for (const n of names) writeFileSync(path(n), "");
    h = await startHarness(new FileStore(storeDir));
    h.app.screenCommand({ command: "home" });
    const phone = await h.connectPhone();
    h.mac.folderPick = root;
    await phone.press("up");
    await phone.press("ok");
    for (let i = 0; i < 2; i++) await phone.press("down");
    await phone.press("ok");
    await phone.press("ok");
    await phone.settle();
    await phone.press("home");
    await phone.press("down");
    await phone.press("right");
    await phone.press("ok"); // Library
    await phone.press("ok"); // the folder
    return phone;
  }

  test("colour tiles first, then thumbnails fill in, two at a time, focus stays", async () => {
    const phone = await openRoot();
    expect(entries().every((e) => !e.thumb)).toBe(true);
    await phone.press("right");
    const focus = h.screen.last.focusedId;
    expect(h.thumbnails.started).toEqual([path("a"), path("b")]);
    h.thumbnails.finish(path("a"));
    await phone.settle();
    expect(entries()[0]!.thumb).toContain("a.mkv");
    expect(h.screen.last.focusedId).toBe(focus);
    expect(h.thumbnails.started).toHaveLength(3);
    h.thumbnails.finish(path("b"));
    h.thumbnails.finish(path("c"));
    await phone.settle();
    h.thumbnails.finish(path("d"));
    await phone.settle();
    expect(h.thumbnails.maxInFlight).toBe(2);
    expect(entries().every((e) => e.thumb)).toBe(true);
    expect(h.screen.last.focusedId).toBe(focus);

    await phone.press("back");
    await phone.press("ok");
    expect(entries().every((e) => e.thumb)).toBe(true);
    expect(h.thumbnails.started).toHaveLength(4);
  });

  test("a failure keeps the colour tile and the queue goes on", async () => {
    const phone = await openRoot();
    h.thumbnails.fail(path("a"));
    await phone.settle();
    h.thumbnails.finish(path("b"));
    h.thumbnails.finish(path("c"));
    await phone.settle();
    h.thumbnails.finish(path("d"));
    await phone.settle();
    expect(entries().map((e) => !!e.thumb)).toEqual([false, true, true, true]);
  });
});

describe("folder mosaics", () => {
  let h: Harness;
  afterEach(() => h?.stop());

  async function openLibrary() {
    h = await startHarness(new FileStore(storeDir));
    h.app.screenCommand({ command: "home" });
    const phone = await h.connectPhone();
    h.mac.folderPick = root;
    await phone.press("up");
    await phone.press("ok");
    for (let i = 0; i < 2; i++) await phone.press("down");
    await phone.press("ok");
    await phone.press("ok");
    await phone.settle();
    await phone.press("home");
    await phone.press("down");
    await phone.press("right");
    await phone.press("ok");
    return phone;
  }
  const rootEntry = () => h.screen.last.library!.entries[0]!;

  test("a folder carries up to four thumbnail URLs from its videos, filling in", async () => {
    for (const n of ["a", "b", "c", "d", "e"]) writeFileSync(join(root, `${n}.mkv`), "");
    const phone = await openLibrary();
    expect(rootEntry().mosaic).toBeUndefined();
    const focus = h.screen.last.focusedId;
    h.thumbnails.finish(join(root, "a.mkv"));
    await phone.settle();
    expect(rootEntry().mosaic).toHaveLength(1);
    for (const n of ["b", "c", "d", "e"]) {
      h.thumbnails.finish(join(root, `${n}.mkv`));
      await phone.settle();
    }
    expect(rootEntry().mosaic).toHaveLength(4);
    expect(rootEntry().mosaic![0]).toContain("a.mkv");
    expect(h.screen.last.focusedId).toBe(focus);
  });

  test("an empty folder gets no mosaic and queues nothing", async () => {
    await openLibrary();
    expect(rootEntry().mosaic).toBeUndefined();
    expect(rootEntry().count).toBe(0);
    expect(h.thumbnails.started).toEqual([]);
  });
});

const ffmpeg = findFfmpeg();
describe.skipIf(!ffmpeg)("FfmpegThumbnails (real ffmpeg)", () => {
  function video(file: string, color: string) {
    const r = spawnSync(ffmpeg!, [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=640x360:d=10`,
      "-pix_fmt",
      "yuv420p",
      file,
    ]);
    expect(r.status).toBe(0);
  }
  test("makes once, caches across instances, remakes on change, survives garbage", async () => {
    const dir = join(storeDir, "thumbs");
    const file = join(root, "v.mp4");
    video(file, "red");
    const t = new FfmpegThumbnails(dir, ffmpeg);
    expect(t.cached(file)).toBeUndefined();
    const url = await t.make(file);
    expect(url).toMatch(/^file:\/\/.*\.jpg$/);
    expect(new FfmpegThumbnails(dir, "/nonexistent/ffmpeg").cached(file)).toBe(url);

    video(file, "blue");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(t.cached(file)).toBeUndefined();
    const url2 = await t.make(file);
    expect(url2).not.toBe(url);

    mkdirSync(dir, { recursive: true });
    const bad = join(root, "bad.mkv");
    writeFileSync(bad, "not a video");
    expect(await t.make(bad)).toBeUndefined();
    expect(existsSync(dir)).toBe(true);
  });
});
