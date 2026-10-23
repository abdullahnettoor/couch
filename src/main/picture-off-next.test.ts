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
  root = mkdtempSync(join(tmpdir(), "couch-picnext-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-picnextstore-"));
  mkdirSync(join(root, "Show"), { recursive: true });
  for (const n of [1, 2, 3]) writeFileSync(join(root, "Show", `Show S01E0${n}.mkv`), "");
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
  h.player.emit({ type: "duration", seconds: 600 });
  await phone.press({ command: "setPictureOff", args: { on: true } });
});
afterEach(async () => {
  await h.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

describe("Picture off at the end of a Library video that has a next one", () => {
  test("the end-of-video card is not covered", async () => {
    expect(phone.last?.pictureOff).toBe(true);
    h.player.emit({ type: "ended", reason: "eof" });
    await phone.waitFor(() => phone.last?.pictureOff === false);
    expect(h.screen.last.state.pictureOff).toBe(false);
    expect(h.screen.last.state.controls).toBe("next");
  });
});
