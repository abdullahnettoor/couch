import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness, type FakePhone } from "./testing/harness.ts";

let root: string;
let h: Harness;
let phone: FakePhone;
const MIN = 60_000;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "couch-everyday-"));
  mkdirSync(join(root, "Movies"));
  writeFileSync(join(root, "Movies", "Dune.mkv"), "");
  const store = new FileStore(mkdtempSync(join(tmpdir(), "couch-everyday-store-")));
  store.write("library", { folders: [root] });
  h = await startHarness(store);
  phone = await h.connectPhone();
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
});

const awake = () =>
  h.mac.calls.filter((c) => c.call === "keepDisplayAwake").map((c) => c.args[0] as boolean);

async function playVideo() {
  await phone.press("right");
  await phone.press("right");
  await phone.press("ok");
  await phone.press("ok");
  await phone.press("ok");
  await phone.press("ok");
}

describe("display sleep", () => {
  test("Home may sleep the display after 30 idle minutes", () => {
    h.clock.advance(29 * MIN);
    expect(awake().at(-1)).toBe(true);
    h.clock.advance(1 * MIN);
    expect(awake().at(-1)).toBe(false);
  });

  test("any command wakes the display and restarts the idle timer", async () => {
    h.clock.advance(31 * MIN);
    h.mac.calls.length = 0;
    await phone.press("right");
    expect(h.mac.calls.some((c) => c.call === "wakeDisplay")).toBe(true);
    expect(awake().at(-1)).toBe(true);
  });

  test("playback never lets the display sleep", async () => {
    await playVideo();
    expect(h.screen.last.state.view).toBe("player");
    h.clock.advance(60 * MIN);
    expect(awake().at(-1)).toBe(true);
  });

  test("YouTube never lets the display sleep", async () => {
    await phone.press("ok"); // first Home item is YouTube
    expect(h.screen.last.state.view).toBe("app");
    h.clock.advance(60 * MIN);
    expect(awake().at(-1)).toBe(true);
  });
});

describe("displays", () => {
  const builtIn = { id: 1, label: "Built-in", internal: true };
  const monitor = { id: 2, label: "LG TV", internal: false };

  test("plugging in a monitor moves the Screen and the Player to it", () => {
    h.mac.setDisplays([builtIn, monitor]);
    expect(h.mac.calls).toContainEqual({ call: "moveScreenTo", args: [2] });
    expect(h.player.calls).toContainEqual({ call: "setDisplay", args: ["LG TV"] });
    h.mac.setDisplays([builtIn]);
    expect(h.mac.calls).toContainEqual({ call: "moveScreenTo", args: [1] });
  });

  test("a move mpv refuses stops playback safely", async () => {
    await playVideo();
    h.player.displayFails = true;
    h.mac.setDisplays([builtIn, monitor]);
    await phone.waitFor(() => h.screen.last.state.view !== "player");
    expect(h.player.calls.some((c) => c.call === "stop")).toBe(true);
  });
});

describe("quitting", () => {
  test("stops playback and the player before quitting", async () => {
    await playVideo();
    h.player.calls.length = 0;
    h.app.beforeQuit();
    expect(h.player.calls.some((c) => c.call === "stop")).toBe(true);
    expect(h.screen.last.state.view).not.toBe("player");
  });
});
