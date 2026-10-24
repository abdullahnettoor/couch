import { afterEach, describe, expect, test } from "vite-plus/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeWebApp } from "./ports/fakes.ts";
import { FileStore, type Store } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

const entry = (id: string, label: string) => ({
  id,
  label,
  icon: "<svg></svg>",
  action: `app:open:${id}`,
  web: true,
});

async function open(phone: FakePhone, id: string) {
  for (let i = 0; i < 20 && h.screen.last.focusedId !== id; i++) {
    const { grid, focusedId } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === id)!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  await phone.press("ok");
}

const playing = { position: 30, duration: 600, paused: false, title: "Cat video" };

const tracks = (on: string) => ({
  subtitles: ["off", "en", "fr"].map((id) => ({ id, label: id, on: id === on })),
  audio: [],
});

let root: string | undefined;
const films = () => join(root!, "A.Film.2001.mkv");

/** Continue watching has a video in it. */
function seededStore() {
  root = mkdtempSync(join(tmpdir(), "couch-po-"));
  writeFileSync(films(), "");
  const store = new FileStore(mkdtempSync(join(tmpdir(), "couch-po-store-")));
  store.write("library", { folders: [root] });
  store.write("history", {
    items: { [films()]: { position: 500, duration: 7200, at: 1 } },
  });
  return store;
}

async function libraryPlaying() {
  h = await startHarness(seededStore());
  const phone = await h.connectPhone();
  await phone.press("resume");
  expect(h.screen.last.state.view).toBe("player");
  h.player.emit({ type: "duration", seconds: 7200 });
  await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
  return phone;
}

async function seeded(withTracks: boolean) {
  const r = await start(seededStore(), withTracks);
  return r;
}

async function start(store?: Store, withTracks = false) {
  const tube = new FakeWebApp("tube", "Tube", {
    showVolume: true,
    showSkip: true,
    adapter: withTracks,
  });
  const other = new FakeWebApp("other", "Other", {});
  h = await startHarness(store, {
    apps: [
      { entry: entry("tube", "Tube"), app: tube },
      { entry: entry("other", "Other"), app: other },
    ],
  });
  const phone = await h.connectPhone();
  const second = await h.connectPhone();
  await open(phone, "tube");
  tube.emit({
    type: "playback",
    playback: withTracks ? { ...playing, tracks: tracks("en") } : playing,
  });
  await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
  tube.calls.length = 0;
  return { tube, other, phone, second };
}

describe("Picture off", () => {
  test("the command turns it on and off, and every phone and the Screen see it", async () => {
    const { phone, second } = await start();
    expect(phone.last?.pictureOff).toBe(false);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await second.waitFor(() => second.last?.pictureOff === true);
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.screen.last.state.pictureOff).toBe(true);
    await phone.press({ command: "setPictureOff", args: { on: false } });
    await second.waitFor(() => second.last?.pictureOff === false);
    expect(h.screen.last.state.pictureOff).toBe(false);
  });

  test("it can't be turned on while nothing plays", async () => {
    const { phone, tube } = await start();
    tube.emit({ type: "playback", playback: undefined });
    await phone.waitFor(() => phone.last?.nowPlaying === undefined);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    expect(phone.last?.pictureOff).toBe(false);
  });

  test("playpause acts at once and leaves it on", async () => {
    const { phone, tube } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await phone.press("playpause");
    expect(tube.calls.some((c) => c.call === "playPause")).toBe(true);
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.screen.last.state.pictureOff).toBe(true);
  });

  test("resume on a paused web App plays it, never starts Continue watching, and leaves it on", async () => {
    const { phone, tube } = await seeded(true);
    tube.emit({ type: "playback", playback: { ...playing, paused: true } });
    await phone.waitFor(() => phone.last?.nowPlaying?.paused === true);
    tube.calls.length = 0;
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await phone.press("resume");
    expect(tube.calls.map((c) => c.call)).toEqual(["playPause"]);
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.screen.last.state.view).toBe("app");
    expect(h.player.calls.filter((c) => c.call === "load")).toEqual([]);
  });

  test("resume on a playing web App never pauses it", async () => {
    const { phone, tube } = await seeded(true);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    tube.calls.length = 0;
    await phone.press("resume");
    expect(tube.calls).toEqual([]);
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.screen.last.state.view).toBe("app");
  });

  test("resume on a paused Library video plays it and starts nothing else", async () => {
    const phone = await libraryPlaying();
    h.player.emit({ type: "pause", paused: true });
    await phone.press({ command: "setPictureOff", args: { on: true } });
    h.player.calls.length = 0;
    await phone.press("resume");
    expect(h.player.calls).toEqual([{ call: "setPaused", args: [false] }]);
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.screen.last.state.view).toBe("player");
  });

  test("resume on a playing Library video does nothing and never pauses", async () => {
    const phone = await libraryPlaying();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    h.player.calls.length = 0;
    await phone.press("resume");
    expect(h.player.calls).toEqual([]);
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.screen.last.state.view).toBe("player");
  });

  test("the subtitles toggle on a web App turns the current track off and keeps it on", async () => {
    const { phone, tube } = await seeded(true);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    tube.calls.length = 0;
    await phone.press("subtitles");
    expect(tube.calls).toEqual([{ call: "setTrack", args: ["subtitles", "off"] }]);
    expect(phone.last?.pictureOff).toBe(true);
  });

  test("the subtitles toggle on a web App turns the last track back on, else the first", async () => {
    const { phone, tube } = await seeded(true);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    tube.emit({ type: "playback", playback: { ...playing, tracks: tracks("off") } });
    await phone.waitFor(() => phone.last?.nowPlaying?.subtitles?.[0]?.on === true);
    tube.calls.length = 0;
    await phone.press("subtitles");
    expect(tube.calls).toEqual([{ call: "setTrack", args: ["subtitles", "en"] }]);
    tube.emit({ type: "playback", playback: { ...playing, tracks: tracks("fr") } });
    await phone.waitFor(() => phone.last?.nowPlaying?.subtitles?.[2]?.on === true);
    await phone.press("subtitles");
    tube.emit({ type: "playback", playback: { ...playing, tracks: tracks("off") } });
    await phone.waitFor(() => phone.last?.nowPlaying?.subtitles?.[0]?.on === true);
    tube.calls.length = 0;
    await phone.press("subtitles");
    expect(tube.calls).toEqual([{ call: "setTrack", args: ["subtitles", "fr"] }]);
    expect(phone.last?.pictureOff).toBe(true);
  });

  test("the subtitles toggle on Library video calls setSubtitles and the Remote shows it, picture off still on", async () => {
    const phone = await libraryPlaying();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    h.player.calls.length = 0;
    const before = phone.last?.nowPlaying?.subtitlesOn;
    await phone.press("subtitles");
    expect(h.player.calls).toEqual([{ call: "setSubtitles", args: [!before] }]);
    expect(phone.last?.nowPlaying?.subtitlesOn).toBe(!before);
    expect(phone.last?.pictureOff).toBe(true);
  });

  test("an arrow only restores the picture, without acting", async () => {
    const { phone, tube } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    tube.calls.length = 0;
    await phone.press("left");
    expect(phone.last?.pictureOff).toBe(false);
    expect(tube.calls).toEqual([]);
  });

  test.each(["up", "ok", "back", "home", "left"] as const)("%s restores it", async (key) => {
    const { phone } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await phone.press(key);
    expect(phone.last?.pictureOff).toBe(false);
    expect(h.screen.last.state.view).toBe("app");
  });

  test("a Screen key restores it too", async () => {
    const { phone } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    h.app.screenCommand({ command: "screenKey", args: { text: "x" } });
    await phone.waitFor(() => phone.last?.pictureOff === false);
  });

  test("volume, mute, seek, speed and tracks leave it on", async () => {
    const { phone } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    for (const c of [
      "volUp",
      "volDown",
      "mute",
      { command: "volSet", args: { percent: 40 } },
      { command: "seekBy", args: { seconds: 10 } },
      { command: "seekTo", args: { seconds: 5 } },
      { command: "setSpeed", args: { speed: 1.5 } },
      { command: "setTrack", args: { kind: "subtitles", track: "en" } },
    ] as const) {
      await phone.press(c);
      expect(phone.last?.pictureOff).toBe(true);
    }
  });

  test("ending playback clears it", async () => {
    const { phone, tube } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    tube.emit({ type: "playback", playback: undefined });
    await phone.waitFor(() => phone.last?.pictureOff === false);
  });

  test("going Home clears it, and playback resuming doesn't bring it back", async () => {
    const { phone, second, tube } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await phone.press("home"); // the first key only restores the picture
    await phone.press("home");
    expect(h.screen.last.state.view).toBe("home");
    await second.waitFor(() => second.last?.pictureOff === false);
    expect(phone.last?.pictureOff).toBe(false);
    expect(h.screen.last.state.pictureOff).toBe(false);
    tube.emit({ type: "playback", playback: { ...playing, position: 45 } });
    await open(phone, "tube");
    expect(phone.last?.pictureOff).toBe(false);
    expect(h.screen.last.state.pictureOff).toBe(false);
  });

  test("changing App clears it, and the first App playing again stays uncovered", async () => {
    const { phone, second, tube, other } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await phone.press("home");
    await phone.press("home");
    await open(phone, "other");
    other.emit({ type: "playback", playback: { ...playing, title: "Other video" } });
    await phone.waitFor(() => phone.last?.nowPlaying?.title === "Other video");
    expect(phone.last?.pictureOff).toBe(false);
    expect(second.last?.pictureOff).toBe(false);
    expect(h.screen.last.state.pictureOff).toBe(false);
    tube.emit({ type: "playback", playback: { ...playing, position: 99 } });
    await phone.press("home");
    await open(phone, "tube");
    expect(phone.last?.pictureOff).toBe(false);
    expect(h.screen.last.state.pictureOff).toBe(false);
  });

  test("a video that ends but stays on the page clears it, and it can't be turned on again", async () => {
    const { phone, second, tube } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    tube.emit({ type: "playback", playback: { ...playing, position: 600, ended: true } });
    await second.waitFor(() => second.last?.pictureOff === false);
    expect(h.screen.last.state.pictureOff).toBe(false);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    expect(phone.last?.pictureOff).toBe(false);
  });

  test("a new video in the same App keeps it on", async () => {
    const { phone, tube } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    tube.emit({ type: "playback", playback: { ...playing, position: 31, title: "Next" } });
    await phone.waitFor(() => phone.last?.nowPlaying?.title === "Next");
    expect(phone.last?.pictureOff).toBe(true);
  });

  test("it stays off after being restored: a later play doesn't bring it back", async () => {
    const { phone, tube } = await start();
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await phone.press("ok");
    tube.emit({ type: "playback", playback: { ...playing, position: 40 } });
    await phone.waitFor(() => phone.last?.nowPlaying?.position === 40);
    expect(phone.last?.pictureOff).toBe(false);
  });
});
