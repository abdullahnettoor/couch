import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { FakeWebApp } from "./ports/fakes.ts";
import { FakeRemoteCommands } from "./ports/fakes-media-keys.ts";
import { MediaKeys } from "./media-keys.ts";
import { focusFolders, startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
afterEach(() => h.stop());

const entry = {
  id: "tube",
  label: "Tube",
  icon: "<svg></svg>",
  action: "app:open:tube",
  web: true,
};

async function start(now?: () => number) {
  const tube = new FakeWebApp("tube", "Tube", { showVolume: true, showSkip: true });
  h = await startHarness(undefined, { apps: [{ entry, app: tube }] });
  const center = new FakeRemoteCommands();
  const keys = new MediaKeys(h.app.core, center, now);
  const phone = await h.connectPhone();
  for (let i = 0; i < 20 && h.screen.last.focusedId !== "tube"; i++) {
    const { grid, focusedId } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === "tube")!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  await phone.press("ok");
  tube.calls.length = 0;
  return { tube, phone, center, keys };
}

const play = (tube: FakeWebApp, paused: boolean, position = 30, title = "Cat video") =>
  tube.emit({ type: "playback", playback: { position, duration: 600, paused, title } });

describe("Mac media keys", () => {
  test("register nothing while nothing plays", async () => {
    const { center, tube } = await start();
    expect(center.registered).toBe(false);
    expect(center.log).toEqual([]);
    tube.emit({ type: "playback", playback: undefined });
    expect(center.registered).toBe(false);
  });

  test("playing registers, publishes Now Playing, and stopping releases it", async () => {
    const { center, tube } = await start();
    play(tube, false);
    expect(center.registered).toBe(true);
    expect(center.info).toEqual({
      title: "Cat video",
      app: "Tube",
      position: 30,
      duration: 600,
      paused: false,
    });
    tube.emit({ type: "playback", playback: undefined });
    expect(center.registered).toBe(false);
    expect(center.info).toBeUndefined();
    expect(center.log.filter((l) => l === "stop")).toHaveLength(1);
  });

  test("toggle reaches play/pause", async () => {
    const { center, tube } = await start();
    play(tube, false);
    center.press("toggle");
    expect(tube.calls).toEqual([{ call: "playPause", args: [] }]);
  });

  test("play only acts while paused, pause only while playing", async () => {
    const { center, tube } = await start();
    play(tube, false);
    center.press("play");
    expect(tube.calls).toEqual([]);
    center.press("pause");
    expect(tube.calls).toEqual([{ call: "playPause", args: [] }]);
    tube.calls.length = 0;
    play(tube, true);
    center.press("pause");
    expect(tube.calls).toEqual([]);
    center.press("play");
    expect(tube.calls).toEqual([{ call: "playPause", args: [] }]);
  });

  test("next and previous seek 10 s like the phone", async () => {
    const { center, tube } = await start();
    play(tube, false);
    center.press("next");
    center.press("previous");
    expect(tube.calls).toEqual([
      { call: "seekBy", args: [10] },
      { call: "seekBy", args: [-10] },
    ]);
  });

  test("pausing is published at once; ordinary progress is not republished", async () => {
    const { center, tube } = await start();
    play(tube, false, 30);
    const before = center.log.length;
    play(tube, false, 31);
    play(tube, false, 32);
    expect(center.log.length).toBe(before);
    play(tube, true, 32);
    expect(center.info?.paused).toBe(true);
    play(tube, true, 200);
    expect(center.info?.position).toBe(200);
  });

  test("a press with nothing playing does nothing", async () => {
    const { center, tube } = await start();
    play(tube, false);
    tube.emit({ type: "playback", playback: undefined });
    center.press("toggle");
    expect(tube.calls).toEqual([]);
  });

  test("dispose releases the keys", async () => {
    const { center, tube, keys } = await start();
    play(tube, false);
    keys.dispose();
    expect(center.registered).toBe(false);
  });
});

describe("Mac media keys: position", () => {
  test("a position that keeps up with the Mac's own clock is not republished; a jump is", async () => {
    let t = 0;
    const { tube, center } = await start(() => t);
    play(tube, false, 30);
    const before = center.log.length;
    t = 3000;
    play(tube, false, 33);
    expect(center.log.length).toBe(before);
    play(tube, false, 90);
    expect(center.info?.position).toBe(90);
  });
});

describe("Mac media keys: Library with Picture off", () => {
  test("play/pause pauses the video, leaves Picture off on and shows the Library as the App", async () => {
    const root = mkdtempSync(join(tmpdir(), "couch-mk-"));
    const storeDir = mkdtempSync(join(tmpdir(), "couch-mkstore-"));
    try {
      mkdirSync(join(root, "Movies"));
      writeFileSync(join(root, "Movies", "Dune.2021.1080p.mkv"), "");
      const store = new FileStore(storeDir);
      store.write("library", { folders: [root] });
      h = await startHarness(store);
      const center = new FakeRemoteCommands();
      new MediaKeys(h.app.core, center);
      const phone = await h.connectPhone();
      await phone.press("right");
      await phone.press("right");
      await phone.press("ok");
      await focusFolders(h, phone);
      await phone.press("ok");
      await phone.press("ok");
      await phone.press("ok");
      await phone.press({ command: "setPictureOff", args: { on: true } });
      expect(center.registered).toBe(true);
      expect(center.info?.app).toBe("Library");
      center.press("toggle");
      expect(h.player.calls.some((c) => c.call === "setPaused")).toBe(true);
      expect(phone.last?.pictureOff).toBe(true);
    } finally {
      await h.stop();
      rmSync(root, { recursive: true, force: true });
      rmSync(storeDir, { recursive: true, force: true });
    }
  });
});
