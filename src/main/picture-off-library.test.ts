import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { focusFolders, startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "couch-pic-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-picstore-"));
  mkdirSync(join(root, "Movies"));
  writeFileSync(join(root, "Movies", "Dune.2021.1080p.mkv"), "");
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store);
  phone = await h.connectPhone();
  await phone.press("right");
  await phone.press("right");
  await phone.press("ok");
  await focusFolders(h, phone);
  await phone.press("ok");
  await phone.press("ok");
  await phone.press("ok");
  await phone.press({ command: "setPictureOff", args: { on: true } });
});
afterEach(async () => {
  await h.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

describe("Picture off in the Library", () => {
  test("it covers a playing video, and playback isn't touched", async () => {
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.player.calls.map((c) => c.call)).not.toContain("pause");
  });

  test("the Screen reports playback on screen while the Library video plays", async () => {
    expect(h.screen.last.playing).toBe(true);
    await phone.press("back");
    await phone.press("home");
    expect(h.screen.last.playing).toBe(false);
  });

  test("the video ending clears it", async () => {
    h.player.emit({ type: "ended", reason: "eof" });
    await phone.waitFor(() => phone.last?.pictureOff === false);
  });

  test("a key brings the picture back and does nothing else", async () => {
    await phone.press("back");
    expect(phone.last).toMatchObject({ pictureOff: false, view: "player" });
  });

  test("playpause while hidden pauses and leaves it on", async () => {
    await phone.press("playpause");
    expect(phone.last?.pictureOff).toBe(true);
    expect(h.player.calls.some((c) => c.call === "setPaused")).toBe(true);
  });
});
