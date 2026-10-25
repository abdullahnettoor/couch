import { afterEach, describe, expect, test } from "vite-plus/test";
import { FakeWebApp } from "./ports/fakes.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

const entry = {
  id: "tube",
  label: "Tube",
  icon: "<svg></svg>",
  action: "app:open:tube",
  web: true,
};

const tracks = {
  subtitles: [
    { id: "off", label: "Off", on: false },
    { id: "en", label: "English", on: true },
  ],
  audio: [{ id: "a1", label: "English", on: true }],
};

async function start(options: ConstructorParameters<typeof FakeWebApp>[2] = {}) {
  const tube = new FakeWebApp("tube", "Tube", { showVolume: true, showSkip: true, ...options });
  h = await startHarness(undefined, { apps: [{ entry, app: tube }] });
  const phone = await h.connectPhone();
  for (let i = 0; i < 20 && h.screen.last.focusedId !== "tube"; i++) {
    const { grid, focusedId } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === "tube")!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  await phone.press("ok");
  tube.calls.length = 0;
  return { tube, phone };
}

describe("Now Playing for a web App", () => {
  test("appears while the front App reports a video, and goes when it stops", async () => {
    const { tube, phone } = await start();
    expect(phone.last?.nowPlaying).toBeUndefined();
    tube.emit({
      type: "playback",
      playback: { position: 30, duration: 600, paused: false, title: "Cat video" },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    expect(phone.last?.nowPlaying).toMatchObject({
      title: "Cat video",
      position: 30,
      duration: 600,
      paused: false,
      canSeek: false,
    });
    tube.emit({ type: "playback", playback: undefined });
    await phone.waitFor(() => phone.last?.nowPlaying === undefined);
  });

  test("falls back to the App's name without a title, and carries artwork", async () => {
    const { tube, phone } = await start();
    tube.emit({
      type: "playback",
      playback: { position: 1, duration: 10, paused: true, artwork: "https://img.example/a.jpg" },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    expect(phone.last?.nowPlaying).toMatchObject({
      title: "Tube",
      paused: true,
      artwork: "https://img.example/a.jpg",
    });
  });

  test("play/pause and ±10 s reach the App; without an adapter the seek bar is read-only", async () => {
    const { tube, phone } = await start();
    tube.emit({ type: "playback", playback: { position: 30, duration: 600, paused: false } });
    await phone.settle();
    await phone.press("playpause");
    await phone.press({ command: "seekBy", args: { seconds: -10 } });
    await phone.press({ command: "seekTo", args: { seconds: 200 } });
    await phone.press({ command: "setTrack", args: { kind: "audio", track: "a1" } });
    expect(tube.calls.map((c) => c.call)).toEqual(["playPause", "seekBy"]);
    expect(tube.calls[1]!.args).toEqual([-10]);
  });

  test("with an adapter: canSeek, seek and the pickers reach the App", async () => {
    const { tube, phone } = await start({ adapter: true });
    tube.emit({
      type: "playback",
      playback: { position: 30, duration: 600, paused: false, canSeek: true, tracks },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    expect(phone.last?.nowPlaying).toMatchObject({
      canSeek: true,
      subtitles: tracks.subtitles,
      audio: tracks.audio,
    });
    await phone.press({ command: "seekTo", args: { seconds: 200 } });
    await phone.press({ command: "setTrack", args: { kind: "subtitles", track: "off" } });
    expect(tube.calls.map((c) => [c.call, ...c.args])).toEqual([
      ["seekTo", 200],
      ["setTrack", "subtitles", "off"],
    ]);
  });

  describe("speed", () => {
    const speeds = [0.5, 1, 1.5];
    const report = (speed: number, title = "One") => ({
      type: "playback" as const,
      playback: { position: 30, duration: 600, paused: false, title, speed, speeds },
    });
    const speedCalls = () => tubeCalls().filter((c) => c[0] === "setSpeed");
    let tubeRef: FakeWebApp;
    const tubeCalls = () => tubeRef.calls.map((c) => [c.call, ...c.args]);

    test("the phone gets the App's speed and choices; setSpeed reaches the App", async () => {
      const { tube, phone } = await start({ adapter: true });
      tubeRef = tube;
      tube.emit(report(1));
      await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
      expect(phone.last!.nowPlaying).toMatchObject({ speed: 1, speeds });
      await phone.press({ command: "setSpeed", args: { speed: 1.5 } });
      expect(speedCalls()).toEqual([["setSpeed", 1.5]]);
      await phone.press({ command: "setSpeed", args: { speed: 3 } });
      expect(speedCalls()).toHaveLength(1);
    });

    test("no speed in the report: no speed on the phone", async () => {
      const { tube, phone } = await start({ adapter: true });
      tube.emit({ type: "playback", playback: { position: 1, duration: 9, paused: false } });
      await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
      expect(phone.last!.nowPlaying).not.toHaveProperty("speeds");
    });

    test("an App that can't set speed: no speed on the phone", async () => {
      const { tube, phone } = await start();
      tube.emit(report(1));
      await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
      expect(phone.last!.nowPlaying).not.toHaveProperty("speeds");
    });

    test("a page that resets the speed is told again; a new video goes back to 1×", async () => {
      const { tube, phone } = await start({ adapter: true });
      tubeRef = tube;
      tube.emit(report(1));
      await phone.settle();
      await phone.press({ command: "setSpeed", args: { speed: 1.5 } });
      tube.emit(report(1));
      await phone.settle();
      expect(speedCalls()).toHaveLength(1);
      h.clock.advance(3500);
      tube.emit(report(1));
      await phone.settle();
      expect(speedCalls()).toEqual([
        ["setSpeed", 1.5],
        ["setSpeed", 1.5],
      ]);
      tube.emit(report(1.5));
      await phone.settle();
      expect(speedCalls()).toHaveLength(2);
      tube.emit(report(1.5, "Two"));
      await phone.settle();
      expect(speedCalls().at(-1)).toEqual(["setSpeed", 1]);
    });
  });

  describe("a speed chosen on the page itself", () => {
    const speeds = [0.5, 1, 1.5, 2];
    const report = (speed: number, title = "One") => ({
      type: "playback" as const,
      playback: { position: 30, duration: 600, paused: false, title, speed, speeds },
    });
    const setSpeeds = (tube: FakeWebApp) =>
      tube.calls.filter((c) => c.call === "setSpeed").map((c) => c.args[0]);

    test("is kept, never set back, and the phone shows it", async () => {
      const { tube, phone } = await start({ adapter: true });
      tube.emit(report(1));
      await phone.settle();
      h.clock.advance(5000);
      tube.emit(report(1.5));
      await phone.settle();
      h.clock.advance(10000);
      tube.emit(report(1.5));
      await phone.settle();
      expect(setSpeeds(tube)).toEqual([]);
      expect(phone.last!.nowPlaying!.speed).toBe(1.5);
      tube.emit(report(1));
      await phone.settle();
      expect(setSpeeds(tube)).toEqual([1.5]);
    });

    test("a drop to 1× with no recent input is re-applied", async () => {
      const { tube, phone } = await start({ adapter: true });
      tube.emit(report(1));
      h.clock.advance(5000);
      tube.emit(report(1.5));
      await phone.settle();
      h.clock.advance(10000);
      tube.emit({ type: "input" });
      h.clock.advance(5000);
      tube.emit(report(1));
      await phone.settle();
      expect(setSpeeds(tube)).toEqual([1.5]);
    });

    test("a drop to 1× right after page input is kept", async () => {
      const { tube, phone } = await start({ adapter: true });
      tube.emit(report(1));
      h.clock.advance(5000);
      tube.emit(report(1.5));
      await phone.settle();
      h.clock.advance(10000);
      tube.emit({ type: "input" });
      h.clock.advance(500);
      tube.emit(report(1));
      await phone.settle();
      h.clock.advance(10000);
      tube.emit(report(1));
      await phone.settle();
      expect(setSpeeds(tube)).toEqual([]);
      expect(phone.last!.nowPlaying!.speed).toBe(1);
    });

    test("a new video starts at 1× even if the page carried the speed over", async () => {
      const { tube, phone } = await start({ adapter: true });
      tube.emit(report(1));
      h.clock.advance(5000);
      tube.emit(report(1.5));
      await phone.settle();
      tube.emit({ type: "input" });
      tube.emit(report(1.5, "Two"));
      await phone.settle();
      expect(setSpeeds(tube)).toEqual([1]);
    });

    test("a phone setSpeed still works and then holds", async () => {
      const { tube, phone } = await start({ adapter: true });
      tube.emit(report(1));
      await phone.settle();
      await phone.press({ command: "setSpeed", args: { speed: 2 } });
      h.clock.advance(3500);
      tube.emit(report(1));
      await phone.settle();
      expect(setSpeeds(tube)).toEqual([2, 2]);
    });
  });

  test("a missing playback report keeps the chosen speed for the same video", async () => {
    const { tube, phone } = await start({ adapter: true });
    const base = {
      position: 30,
      duration: 600,
      paused: false,
      title: "One",
      speeds: [0.5, 1, 1.5],
    };
    tube.emit({ type: "playback", playback: { ...base, speed: 1 } });
    await phone.settle();
    await phone.press({ command: "setSpeed", args: { speed: 1.5 } });
    tube.emit({ type: "playback", playback: undefined });
    await phone.settle();
    tube.emit({ type: "playback", playback: { ...base, speed: 1.5 } });
    await phone.settle();
    h.clock.advance(3500);
    tube.emit({ type: "playback", playback: { ...base, speed: 1 } });
    await phone.settle();
    const calls = tube.calls.filter((c) => c.call === "setSpeed").map((c) => c.args[0]);
    expect(calls).toEqual([1.5, 1.5]);
  });

  test("a prompt shows while the App reports one; pressPrompt reaches the App for the showing id only", async () => {
    const { tube, phone } = await start({ adapter: true });
    const base = { position: 30, duration: 600, paused: false };
    tube.emit({ type: "playback", playback: base });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    expect(phone.last?.nowPlaying?.prompt).toBeUndefined();
    await phone.press({ command: "pressPrompt", args: { id: "skipIntro" } });
    expect(tube.calls.map((c) => c.call)).not.toContain("pressPrompt");

    const prompt = { id: "skipIntro", label: "Skip Intro" } as const;
    tube.emit({ type: "playback", playback: { ...base, prompt } });
    await phone.waitFor(() => phone.last?.nowPlaying?.prompt !== undefined);
    expect(phone.last?.nowPlaying?.prompt).toEqual(prompt);
    await phone.press({ command: "pressPrompt", args: { id: "nextEpisode" } });
    await phone.press({ command: "pressPrompt", args: { id: "skipIntro" } });
    expect(tube.calls.filter((c) => c.call === "pressPrompt").map((c) => c.args)).toEqual([
      ["skipIntro"],
    ]);

    tube.emit({ type: "playback", playback: base });
    await phone.waitFor(() => phone.last?.nowPlaying?.prompt === undefined);
  });

  test("an App without an adapter shows no prompt", async () => {
    const { tube, phone } = await start();
    tube.emit({
      type: "playback",
      playback: {
        position: 1,
        duration: 9,
        paused: false,
        prompt: { id: "skipIntro", label: "x" },
      },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    expect(phone.last?.nowPlaying?.prompt).toBeUndefined();
  });

  test("a report from an App that isn't in front is not shown", async () => {
    const { tube, phone } = await start();
    await phone.press("home");
    tube.emit({ type: "playback", playback: { position: 1, duration: 9, paused: false } });
    await phone.settle();
    expect(phone.last?.nowPlaying).toBeUndefined();
  });

  test("leaving the App forgets what it was playing", async () => {
    const { tube, phone } = await start();
    tube.emit({ type: "playback", playback: { position: 1, duration: 9, paused: false } });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    await phone.press("home");
    expect(phone.last?.nowPlaying).toBeUndefined();
    await phone.press("ok");
    expect(phone.last?.nowPlaying).toBeUndefined();
  });
});
