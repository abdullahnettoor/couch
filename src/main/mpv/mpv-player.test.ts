import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, expect, test } from "vite-plus/test";
import type { PlayerEvent } from "../../shared/player.ts";
import { findMpv } from "./find-mpv.ts";
import { buildMpvArgs, MpvPlayer } from "./mpv-player.ts";

type MpvTestHandle = { send(args: unknown[]): Promise<unknown> };

const mpvPath = findMpv();
const sample = ".dev/sample.mkv";
const realMpv = mpvPath && existsSync(sample) ? test : test.skip;

let player: MpvPlayer | undefined;
afterEach(async () => {
  await player?.dispose();
  player = undefined;
});

test("builds flags for a full-screen, chrome-free, Space-free mpv without a forced window", () => {
  const args = buildMpvArgs("/tmp/x.sock", "LG TV");
  expect(args).toContain("--idle=yes");
  expect(args).toContain("--no-native-fs");
  expect(args).toContain("--input-ipc-server=/tmp/x.sock");
  expect(args).toContain("--fs-screen-name=LG TV");
  expect(args).toContain("--macos-app-activation-policy=accessory");
  expect(args.some((a) => a.startsWith("--force-window"))).toBe(false);
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
  "the video window keeps full screen and hands the Screen's keys to Couch",
  async () => {
    player = new MpvPlayer({ mpvPath, extraArgs: ["--vo=null", "--ao=null"] });
    const events: PlayerEvent[] = [];
    player.onEvent((e) => events.push(e));
    await player.start();
    await player.load(sample);
    await new Promise((r) => setTimeout(r, 400));
    const mpv = (args: unknown[]) => (player as unknown as MpvTestHandle).send(args);
    for (const key of ["ESC", "f", "q", "BS", "MBTN_LEFT_DBL"]) await mpv(["keypress", key]);
    for (const key of ["LEFT", "ENTER", "h"]) await mpv(["keypress", key]);
    await new Promise((r) => setTimeout(r, 300));
    expect(player.running).toBe(true);
    expect(await mpv(["get_property", "fullscreen"])).toBe(true);
    expect(events.filter((e) => e.type === "key")).toEqual([
      { type: "key", command: "back" },
      { type: "key", command: "left" },
      { type: "key", command: "ok" },
      { type: "key", command: "home" },
    ]);
  },
  10000,
);

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
