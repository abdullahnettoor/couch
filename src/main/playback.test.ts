import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { focusFolders, startHarness, type Harness, type FakePhone } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;
const video = () => join(root, "Movies", "Dune.2021.1080p.mkv");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-play-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-playstore-"));
  mkdirSync(join(root, "Movies"));
  writeFileSync(video(), "");
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

async function start() {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store);
  phone = await h.connectPhone();
}

/** Home → Library → root → Movies → the video, then OK. */
async function playVideo() {
  await phone.press("right");
  await phone.press("right");
  await phone.press("ok"); // Library
  await focusFolders(h, phone);
  await phone.press("ok"); // the library folder
  await phone.press("ok"); // Movies folder
  await phone.press("ok"); // Dune
}
const calls = (name: string) => h.player.calls.filter((c) => c.call === name);

describe("playing a Library video", () => {
  test("OK loads the right path and the phone switches to Now Playing", async () => {
    await start();
    await playVideo();
    expect(calls("load")[0]!.args[0]).toBe(video());
    expect(phone.last).toMatchObject({
      view: "player",
      nowPlaying: { title: "Dune (2021)", folder: "Movies", paused: false, subtitlesOn: true },
    });
  });

  test("position, duration and pause events reach the phone about once a second", async () => {
    await start();
    await playVideo();
    h.player.emit({ type: "duration", seconds: 600 });
    h.player.emit({ type: "position", seconds: 12.2 });
    await phone.settle();
    expect(phone.last!.nowPlaying).toMatchObject({ position: 12.2, duration: 600 });
    const n = phone.snapshots.length;
    h.player.emit({ type: "position", seconds: 12.7 });
    await phone.settle();
    expect(phone.snapshots.length).toBe(n);
    h.player.emit({ type: "pause", paused: true });
    await phone.settle();
    expect(phone.last!.nowPlaying!.paused).toBe(true);
  });

  test("seekBy, seekTo, OK and playpause reach the Player", async () => {
    await start();
    await playVideo();
    h.player.emit({ type: "duration", seconds: 600 });
    h.clock.advance(4600);
    await phone.press({ command: "seekTo", args: { seconds: 300 } });
    expect(calls("seekTo").at(-1)!.args).toEqual([300]);
    await phone.press({ command: "seekBy", args: { seconds: -10 } });
    expect(calls("seekTo").at(-1)!.args).toEqual([290]);
    for (const key of ["right", "left", "left"] as const) {
      h.clock.advance(4600);
      await phone.press(key);
    }
    expect(calls("seekTo").map((c) => c.args[0])).toEqual([300, 290, 300, 290, 280]);
    h.clock.advance(4600);
    await phone.press("ok");
    expect(calls("setPaused").at(-1)!.args).toEqual([true]);
    expect(h.screen.last.overlay).toMatchObject({
      paused: true,
      dock: { position: 280, duration: 600 },
    });
    await phone.press("playpause");
    expect(calls("setPaused").at(-1)!.args).toEqual([false]);
  });

  test("controls show on any command, hide after 4.5 s while playing, and stay up while paused", async () => {
    await start();
    await playVideo();
    h.player.emit({ type: "duration", seconds: 600 });
    h.clock.advance(4600);
    expect(h.screen.last.state.controls).toBe("hidden");
    expect(h.screen.last.overlay!.dock).toBeUndefined();
    await phone.press("up");
    expect(h.screen.last.state.controls).toBe("dock");
    h.clock.advance(4000);
    await phone.press("volUp");
    h.clock.advance(4000);
    expect(h.screen.last.state.controls).toBe("dock");
    h.clock.advance(600);
    expect(h.screen.last.state.controls).toBe("hidden");
    await phone.press("playpause");
    h.clock.advance(20000);
    expect(h.screen.last.state.controls).toBe("dock");
    await phone.press("playpause");
    h.clock.advance(4600);
    expect(h.screen.last.state.controls).toBe("hidden");
  });

  test("the Screen's showControls brings the dock up; phones cannot send it", async () => {
    await start();
    await playVideo();
    h.clock.advance(4600);
    phone.send("showControls" as never);
    await phone.settle();
    expect(h.screen.last.state.controls).toBe("hidden");
    h.app.screenCommand({ command: "showControls" });
    expect(h.screen.last.state.controls).toBe("dock");
  });

  test("with the controls hidden, Left/Right seek, OK pauses and other keys show the dock", async () => {
    await start();
    await playVideo();
    h.player.emit({ type: "duration", seconds: 600 });
    h.clock.advance(4600);
    await phone.press("right");
    expect(calls("seekTo").at(-1)!.args).toEqual([10]);
    h.clock.advance(4600);
    await phone.press("ok");
    expect(calls("setPaused").at(-1)!.args).toEqual([true]);
    await phone.press("playpause");
    h.clock.advance(4600);
    await phone.press("down");
    expect(h.screen.last.state.controls).toBe("dock");
    expect(calls("seekTo")).toHaveLength(1);
  });

  test("with the dock up, Left/Right move focus along it; bar seeks, slider sets volume", async () => {
    await start();
    await playVideo();
    h.player.emit({ type: "duration", seconds: 600 });
    const focused = () => h.screen.last.overlay!.dock!.focusedId;
    expect(focused()).toBe("playpause");
    await phone.press("right");
    expect(focused()).toBe("back10");
    await phone.press("right");
    expect(focused()).toBe("fwd10");
    await phone.press("right");
    expect(focused()).toBe("bar");
    await phone.press("right");
    expect(calls("seekTo").at(-1)!.args).toEqual([10]);
    expect(focused()).toBe("bar");
    await phone.press("ok");
    expect(calls("setPaused").at(-1)!.args).toEqual([true]);
    await phone.press("left");
    expect(calls("seekTo").at(-1)!.args).toEqual([0]);
    // Left/Right belong to the bar: Down steps off it. Up next is disabled, so focus skips it.
    await phone.press("down");
    expect(focused()).toBe("subtitles");
    await phone.press("left");
    expect(focused()).toBe("bar");
    await phone.press("down");
    await phone.press("right");
    await phone.press("right");
    expect(focused()).toBe("volume");
    await phone.press("right");
    expect(h.player.volume).toBe(65);
    await phone.press("left");
    await phone.press("left");
    expect(h.player.volume).toBe(55);
    await phone.press("up");
    expect(focused()).toBe("volicon");
    await phone.press("left");
    expect(focused()).toBe("subtitles");
    await phone.press("ok");
    expect(calls("setSubtitles").at(-1)!.args).toEqual([false]);
  });

  test("volSet clamps, reaches the Player and is allowed from phones", async () => {
    await start();
    await playVideo();
    await phone.press({ command: "volSet", args: { percent: 70 } });
    expect(h.player.calls.at(-1)).toEqual({ call: "setVolume", args: [70] });
    await phone.press({ command: "volSet", args: { percent: 250 } });
    expect(h.player.volume).toBe(100);
    await phone.press({ command: "volSet", args: { percent: -5 } });
    expect(h.player.volume).toBe(0);
    expect(h.screen.last.state.volumeShown).toBe(true);
    expect(h.screen.last.overlay!.dock!.level).toBe(0);
  });

  test("subtitles are raised while the dock shows and lowered when it hides", async () => {
    await start();
    await playVideo();
    const raised = () => calls("setSubtitlesRaised").map((c) => c.args[0]);
    expect(raised().at(-1)).toBe(true);
    h.clock.advance(4600);
    expect(raised().at(-1)).toBe(false);
    await phone.press("up");
    expect(raised().at(-1)).toBe(true);
    await phone.press("back");
    expect(raised().at(-1)).toBe(false);
  });

  test("the subtitles toggle reaches the Player and is remembered after a restart", async () => {
    await start();
    await playVideo();
    await phone.press("subtitles");
    expect(calls("setSubtitles").at(-1)!.args).toEqual([false]);
    expect(phone.last!.nowPlaying!.subtitlesOn).toBe(false);
    await h.stop();
    h = await startHarness(new FileStore(storeDir));
    phone = await h.connectPhone();
    await playVideo();
    expect(calls("load")[0]!.args[1]).toMatchObject({ subtitles: false });
    expect(phone.last!.nowPlaying!.subtitlesOn).toBe(false);
  });

  test("volume reaches the Player, shows on the Screen and on every phone", async () => {
    await start();
    const other = await h.connectPhone();
    await playVideo();
    await phone.press("volUp");
    expect(h.player.calls.at(-1)).toEqual({ call: "setVolume", args: [65] });
    await other.settle();
    expect(other.last!.volume).toBe(65);
    expect(h.screen.last.state.volumeShown).toBe(true);
    expect(h.screen.last.overlay!.volume).toBe(65);
    await phone.press("volDown");
    await phone.press("volDown");
    expect(h.player.volume).toBe(55);
    h.clock.advance(3500);
    expect(h.screen.last.state.volumeShown).toBe(false);
  });

  test("Back stops playback and returns to the folder", async () => {
    await start();
    await playVideo();
    await phone.press("back");
    expect(calls("stop")).toHaveLength(1);
    expect(h.screen.last.state.view).toBe("folder");
    expect(phone.last!.nowPlaying).toBeUndefined();
    expect(h.screen.last.overlay).toBeUndefined();
    h.player.emit({ type: "ended", reason: "stop" });
    expect(h.screen.last.state.view).toBe("folder");
  });

  test("keys pressed on the Mac while the video window has focus act like the Screen's keys", async () => {
    await start();
    await playVideo();
    h.clock.advance(4600);
    h.player.emit({ type: "key", command: "right" });
    expect(calls("seekTo").at(-1)!.args[0]).toBe(10);
    h.player.emit({ type: "key", command: "back" });
    await phone.settle();
    expect(calls("stop")).toHaveLength(1);
    expect(h.screen.last.state.view).toBe("folder");
  });

  test("Home stops playback and goes Home", async () => {
    await start();
    await playVideo();
    await phone.press("home");
    expect(calls("stop")).toHaveLength(1);
    expect(h.screen.last.state.view).toBe("home");
    expect(phone.last!.nowPlaying).toBeUndefined();
  });

  test("end of file returns to the folder", async () => {
    await start();
    await playVideo();
    h.player.emit({ type: "ended", reason: "eof" });
    await phone.settle();
    expect(h.screen.last.state.view).toBe("folder");
    expect(phone.last!.view).toBe("folder");
  });

  test("a stale stop event does not end the next video", async () => {
    await start();
    await playVideo();
    await phone.press("back");
    await phone.press("ok");
    h.player.emit({ type: "ended", reason: "stop" });
    expect(h.screen.last.state.view).toBe("player");
  });

  test("with mpv missing, OK shows the install message instead of playing", async () => {
    await start();
    h.player.emit({ type: "missing" });
    await playVideo();
    expect(calls("load")).toHaveLength(0);
    expect(h.screen.last.state.view).toBe("folder");
    expect(h.screen.last.state.toast).toContain("Couch needs mpv");
  });
});
