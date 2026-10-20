import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
const film = () => join(root, "Films", "A.Film.2001.mkv");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-rg-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-rg-store-"));
  mkdirSync(join(root, "Films"));
  writeFileSync(film(), "");
  new FileStore(storeDir).write("library", { folders: [root] });
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const press = (command: "up" | "down" | "left" | "right" | "ok" | "home") =>
  h.app.screenCommand({ command });
function focusOn(id: string) {
  for (let i = 0; i < 60 && h.app.screen().focusedId !== id; i++) {
    const { grid, focusedId } = h.app.screen();
    const cur = grid.find((x) => x.id === focusedId)!;
    const t = grid.find((x) => x.id === id)!;
    press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(h.app.screen().focusedId).toBe(id);
}

const url = (path: string, key?: string) =>
  `http://127.0.0.1:${h.app.remote.port}${path}${key === undefined ? "" : `?key=${encodeURIComponent(key)}`}`;

describe("layout hint", () => {
  test("follows the view", async () => {
    h = await startHarness();
    const phone = await h.connectPhone();
    expect(phone.last!.layout).toBe("home");
    focusOn("library");
    press("ok");
    await phone.settle();
    expect(phone.last!.layout).toBe("other");
    press("home");
    focusOn("youtube");
    press("ok");
    await phone.settle();
    expect(phone.last!.view).toBe("youtube");
    expect(phone.last!.layout).toBe("youtube");
  });
});

describe("continueCard", () => {
  test("is on Home only, with title, time left and thumbnail key", async () => {
    h = await startHarness(new FileStore(storeDir));
    const key = "a".repeat(40);
    h.thumbnails.cache.set(film(), `file:///thumbs/${key}.jpg`);
    const phone = await h.connectPhone();
    expect(phone.last!.continueCard).toBeUndefined();

    focusOn("library");
    press("ok");
    for (const id of [root, join(root, "Films"), film()]) {
      focusOn(id);
      press("ok");
    }
    h.player.emit({ type: "duration", seconds: 7200 });
    h.player.emit({ type: "position", seconds: 1800 });
    await phone.settle();
    expect(phone.last!.layout).toBe("player");
    expect(phone.last!.continueCard).toBeUndefined();
    press("home");
    await phone.settle();
    expect(phone.last!.layout).toBe("home");
    expect(phone.last!.continueCard).toEqual({
      title: "A Film (2001)",
      left: "90 min left",
      thumbKey: key,
    });
  });
});

describe("thumbnails over HTTP", () => {
  const key = "b".repeat(40);
  beforeEach(async () => {
    h = await startHarness();
    writeFileSync(join(h.thumbDir, `${key}.jpg`), "JPEG");
  });

  test("served with the pairing key", async () => {
    const res = await fetch(url(`/thumb/${key}.jpg`, h.pairingKey()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(await res.text()).toBe("JPEG");
  });

  test("refused without the key or with a stale one", async () => {
    expect((await fetch(url(`/thumb/${key}.jpg`))).status).toBe(401);
    expect((await fetch(url(`/thumb/${key}.jpg`, "nope"))).status).toBe(401);
  });

  test("an unknown cache key is 404", async () => {
    const res = await fetch(url(`/thumb/${"c".repeat(40)}.jpg`, h.pairingKey()));
    expect(res.status).toBe(404);
  });

  test("never serves other paths", async () => {
    writeFileSync(join(h.thumbDir, "..", "secret.txt"), "x");
    for (const p of [
      "/thumb/..%2Fsecret.txt",
      "/thumb/../secret.txt",
      `/thumb/${key}.jpg/../../x`,
      "/thumb/secret.txt",
      "/thumb/%2e%2e/%2e%2e/etc/passwd",
    ]) {
      const res = await fetch(url(p, h.pairingKey()));
      expect([400, 404]).toContain(res.status);
    }
    rmSync(join(h.thumbDir, "..", "secret.txt"), { force: true });
  });
});
