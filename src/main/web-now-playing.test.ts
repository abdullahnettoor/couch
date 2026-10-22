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
