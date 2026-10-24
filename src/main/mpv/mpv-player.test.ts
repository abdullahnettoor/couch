import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, expect, test } from "vite-plus/test";
import type { PlayerEvent } from "../../shared/player.ts";
import { findMpv } from "./find-mpv.ts";
import { buildMpvArgs, MpvPlayer, parseTrackList } from "./mpv-player.ts";

const mpvPath = findMpv();
const sample = ".dev/sample.mkv";
const realMpv = mpvPath && existsSync(sample) ? test : test.skip;

let player: MpvPlayer | undefined;
afterEach(async () => {
  await player?.dispose();
  player = undefined;
});

test("builds headless options with the IPC socket and no window flags", () => {
  const args = buildMpvArgs("/tmp/x.sock");
  expect(args).toContain("--idle=yes");
  expect(args).toContain("--input-ipc-server=/tmp/x.sock");
  expect(args.some((a) => a.startsWith("--fs") || a.startsWith("--force-window"))).toBe(false);
});

test("parseTrackList reads mpv's audio and subtitle tracks with names and the selected one", () => {
  expect(
    parseTrackList([
      { id: 1, type: "video", selected: true },
      { id: 1, type: "audio", lang: "ml", selected: true },
      { id: 2, type: "audio", lang: "en", title: "Commentary", selected: false },
      { id: 1, type: "sub", lang: "en", selected: false },
      { id: 2, type: "sub", selected: true },
      { id: 3, type: "sub", lang: "und", title: "Forced", selected: false },
    ]),
  ).toEqual({
    audio: [
      { id: "1", label: "Malayalam", lang: "ml", selected: true },
      { id: "2", label: "English · Commentary", lang: "en", selected: false },
    ],
    subtitles: [
      { id: "1", label: "English", lang: "en", selected: false },
      { id: "2", label: "Track 2", selected: true },
      { id: "3", label: "Forced", selected: false },
    ],
  });
  expect(
    parseTrackList([
      { id: 1, type: "audio", lang: "fre" },
      { id: 2, type: "audio", lang: "fra" },
      { id: 3, type: "audio", lang: "xyz" },
      { id: 4, type: "audio", lang: "pt-BR" },
    ]).audio.map((t) => t.lang),
  ).toEqual(["fr", "fr", "xyz", "pt-BR"]);
  expect(parseTrackList("nope")).toEqual({ audio: [], subtitles: [] });
});

test("emits `missing` when libmpv can't be loaded for embedding", async () => {
  player = new MpvPlayer({
    mpvPath: undefined,
    embed: () => {
      throw new Error("libmpv not found");
    },
  });
  const events: PlayerEvent[] = [];
  player.onEvent((e) => events.push(e));
  await player.start();
  expect(events).toEqual([{ type: "missing" }]);
});

test("emits `missing` when mpv can't be found", async () => {
  player = new MpvPlayer({ mpvPath: undefined });
  const events: PlayerEvent[] = [];
  player.onEvent((e) => events.push(e));
  await player.start();
  expect(events).toEqual([{ type: "missing" }]);
});

test("a listener added after start still hears that mpv is missing", async () => {
  player = new MpvPlayer({ mpvPath: undefined });
  await player.start();
  const events: PlayerEvent[] = [];
  player.onEvent((e) => events.push(e));
  expect(events).toEqual([{ type: "missing" }]);
});

realMpv(
  "plays, pauses, seeks, reports position, ends, and quits cleanly",
  async () => {
    player = new MpvPlayer({ mpvPath, extraArgs: ["--vo=null", "--ao=null"] });
    const events: PlayerEvent[] = [];
    player.onEvent((e) => events.push(e));
    await player.start();
    expect(player.running).toBe(true);

    await player.load(sample, { startSeconds: 2 });
    await new Promise((r) => setTimeout(r, 400));
    await player.setPaused(true);
    await player.seekTo(10);
    await new Promise((r) => setTimeout(r, 200));
    expect(await player.getPosition()).toBeCloseTo(10, 0);
    await player.seekBy(-4);
    await new Promise((r) => setTimeout(r, 200));
    expect(await player.getPosition()).toBeCloseTo(6, 0);
    expect(events).toContainEqual({ type: "pause", paused: true });

    await player.stop();
    await new Promise((r) => setTimeout(r, 200));
    expect(events).toContainEqual({ type: "ended", reason: "stop" });
    expect(player.running).toBe(true);

    await player.load(sample, { startSeconds: 19 });
    await new Promise((r) => setTimeout(r, 2000));
    expect(events).toContainEqual({ type: "ended", reason: "eof" });

    const pid = player.pid!;
    await player.dispose();
    expect(() => execSync(`kill -0 ${pid}`, { stdio: "ignore" })).toThrow();
  },
  20000,
);
