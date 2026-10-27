import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { StoredPhoto } from "../shared/wallpapers.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let storeDir: string;
let store: FileStore;
let h: Harness;
let phone: FakePhone;
beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "couch-photos-core-"));
  store = new FileStore(storeDir);
});
afterEach(async () => {
  await h?.stop();
  rmSync(storeDir, { recursive: true, force: true });
});

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A fixture image: real magic bytes, then the brightness the fake decoder reads, then padding. */
const image = (brightness: number, magic = JPEG, pad = 100) =>
  Buffer.concat([
    Buffer.from(magic),
    Buffer.alloc(8 - magic.length),
    Buffer.from([Math.round(brightness * 255)]),
    Buffer.alloc(pad),
  ]);
const send = (bytes: Buffer) =>
  phone.press({ command: "addPhoto", args: { data: bytes.toString("base64") } });

const home = () => h.screen.last.home;
const saved = () => store.read<{ wallpaper?: unknown; photos?: StoredPhoto[] }>("home", {});
const start = async () => {
  h = await startHarness(store);
  phone = await h.connectPhone();
};

async function openHomePage() {
  await phone.press("up");
  await phone.press("ok");
  for (let i = 0; i < 12 && h.screen.last.focusedLabel !== "Home"; i++) await phone.press("down");
  await phone.press("ok");
  expect(h.screen.last.state.view).toBe("settingsHome");
}

describe("adding a photo from the phone", () => {
  test("it is checked, re-encoded, stored, made the wallpaper, and its dim comes from its brightness", async () => {
    await start();
    await openHomePage();
    h.clock.advance(5000);
    await send(image(1));
    const [photo] = saved().photos!;
    expect(photo).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{12}$/),
      dim: 0.65,
      addedAt: h.clock.now(),
    });
    expect(saved().wallpaper).toEqual({ kind: "photo", id: photo!.id });
    expect(home()?.wallpaper).toEqual({ kind: "photo", id: photo!.id });
    expect(home()?.photos).toEqual([
      { id: photo!.id, url: `file:///userData/wallpapers/${photo!.id}.jpg`, dim: 0.65 },
    ]);
    // The file holds the re-encoded bytes, not what the phone sent.
    expect(h.photos.files.get(photo!.id)!.toString().startsWith("reencoded:")).toBe(true);
  });

  test("a dark PNG is accepted and dimmed least", async () => {
    await start();
    await openHomePage();
    await send(image(0, PNG));
    expect(saved().photos![0]!.dim).toBeCloseTo(0.35);
  });

  test("the photo shows as a tile after the six built-ins", async () => {
    await start();
    await openHomePage();
    await send(image(0.4));
    const tiles = h.screen.last.grid.filter((g) => g.r === 0);
    expect(tiles.map((g) => g.c)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(tiles[6]!.label).toBe("Photo");
  });

  test("bytes that are not a JPEG or PNG are refused", async () => {
    await start();
    await openHomePage();
    await send(Buffer.from("GIF89a" + "x".repeat(50)));
    expect(h.screen.last.state.toast).toMatch(/photo/i);
    await send(Buffer.from("<svg onload=alert(1)/>"));
    await send(Buffer.from("#!/bin/sh\nrm -rf ~\n"));
    expect(saved().photos).toBeUndefined();
    expect(h.photos.files.size).toBe(0);
  });

  test("a JPEG that does not decode is refused", async () => {
    await start();
    await openHomePage();
    await send(Buffer.from(JPEG));
    expect(saved().photos).toBeUndefined();
    expect(h.screen.last.state.toast).toMatch(/read/i);
  });

  test("a photo over 3 MB is refused; one just under is taken", async () => {
    await start();
    await openHomePage();
    await send(image(0.5, JPEG, 3 * 1024 * 1024));
    expect(saved().photos).toBeUndefined();
    expect(h.screen.last.state.toast).toMatch(/too big/i);
    await send(image(0.5, JPEG, 3 * 1024 * 1024 - 10));
    expect(saved().photos).toHaveLength(1);
  });

  test("a command with no data is refused", async () => {
    await start();
    await openHomePage();
    await phone.press("addPhoto");
    expect(saved().photos).toBeUndefined();
    expect(h.screen.last.state.toast).toBeTruthy();
  });

  test("it is only taken while Settings → Home is on the Screen", async () => {
    await start();
    phone.send({ command: "addPhoto", args: { data: image(0.5).toString("base64") } });
    await phone.settle();
    expect(saved().photos).toBeUndefined();
  });

  test("the seventh photo asks before replacing the oldest", async () => {
    await start();
    await openHomePage();
    for (let i = 0; i < 6; i++) {
      h.clock.advance(1000);
      await send(image(0.5));
    }
    const first = saved().photos![0]!.id;
    expect(saved().photos).toHaveLength(6);
    await send(image(0.2));
    expect(h.screen.last.state.confirm?.title).toMatch(/oldest/i);
    expect(saved().photos).toHaveLength(6);
    await phone.press("back");
    expect(saved().photos).toHaveLength(6);
    expect(h.photos.files.has(first)).toBe(true);

    await send(image(0.2));
    await phone.press("right");
    await phone.press("ok");
    const after = saved().photos!;
    expect(after).toHaveLength(6);
    expect(after.some((p) => p.id === first)).toBe(false);
    expect(h.photos.files.has(first)).toBe(false);
    expect(h.photos.files.size).toBe(6);
    expect(after.at(-1)!.dim).toBe(0.41);
    expect(saved().wallpaper).toEqual({ kind: "photo", id: after.at(-1)!.id });
  });
});

describe("photo tiles", () => {
  async function withPhoto() {
    await start();
    await openHomePage();
    await send(image(0.5));
    return saved().photos![0]!.id;
  }

  test("focusing a photo tile previews it; the saved wallpaper stays until OK", async () => {
    const id = await withPhoto();
    await phone.press("left");
    expect(home()?.preview).toEqual({ kind: "builtin", id: "graphite" });
    await phone.press("right");
    expect(home()?.preview).toEqual({ kind: "photo", id });
  });

  test("OK opens a menu; Use switches to the photo", async () => {
    const id = await withPhoto();
    await phone.press("left");
    await phone.press("ok");
    expect(home()?.wallpaper).toEqual({ kind: "builtin", id: "graphite" });
    await phone.press("right");
    await phone.press("ok");
    expect(h.screen.last.state.confirm?.buttons).toEqual(["Use", "Remove"]);
    expect(home()?.wallpaper.kind).toBe("builtin");
    await phone.press("ok");
    expect(home()?.wallpaper).toEqual({ kind: "photo", id });
    expect(h.screen.last.state.confirm).toBeUndefined();
  });

  test("Remove asks again; removing the current photo falls back to Couch", async () => {
    const id = await withPhoto();
    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    expect(h.screen.last.state.confirm?.buttons[1]).toBe("Remove");
    expect(saved().photos).toHaveLength(1);
    await phone.press("back");
    expect(saved().photos).toHaveLength(1);

    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    expect(saved().photos).toEqual([]);
    expect(h.photos.files.has(id)).toBe(false);
    expect(home()?.wallpaper).toEqual({ kind: "builtin", id: "couch" });
    expect(home()?.photos).toBeUndefined();
  });

  test("removing a photo that is not current keeps the current wallpaper", async () => {
    const id = await withPhoto();
    await phone.press("left");
    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    expect(saved().photos).toEqual([]);
    expect(h.photos.files.has(id)).toBe(false);
    expect(home()?.wallpaper).toEqual({ kind: "builtin", id: "graphite" });
  });
});

describe("photos across a restart", () => {
  test("the choice, the list and the dim survive", async () => {
    await start();
    await openHomePage();
    await send(image(1));
    const id = saved().photos![0]!.id;
    await h.stop();
    await start();
    expect(home()?.wallpaper).toEqual({ kind: "photo", id });
    expect(home()?.photos?.[0]).toMatchObject({ id, dim: 0.65 });
  });

  test("a stored photo choice whose photo is gone falls back to Couch", async () => {
    store.write("home", { wallpaper: { kind: "photo", id: "0123456789ab" }, photos: [] });
    await start();
    expect(home()?.wallpaper).toEqual({ kind: "builtin", id: "couch" });
  });

  test("a stored photo with an odd id is ignored, so it never becomes a file path", async () => {
    store.write("home", {
      wallpaper: { kind: "photo", id: "../../x" },
      photos: [{ id: "../../x", dim: 0.5, addedAt: 1 }],
    });
    await start();
    expect(home()?.wallpaper).toEqual({ kind: "builtin", id: "couch" });
    expect(home()?.photos).toBeUndefined();
  });
});
