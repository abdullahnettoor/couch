import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { REMOTE_PAGE } from "./remote/page.ts";
import { chooseBinding, liveListener, type ListenerProbe } from "./listener.ts";
import { FileStore, MemoryStore } from "./ports/store.ts";
import { focusFolders, startHarness, type Harness } from "./testing/harness.ts";

const status = { pid: 4242, publicPort: 4747, appPort: 4748, token: "s3cret" };
const probe = (alive: boolean, answers = true): ListenerProbe => ({
  pidExists: () => alive,
  portAnswers: () => Promise.resolve(answers),
});
const storeWith = (value?: unknown) => {
  const s = new MemoryStore();
  if (value !== undefined) s.write("listener", value);
  return s;
};

describe("port choice", () => {
  test("a live listener puts Couch on loopback, app port 4748", async () => {
    const live = await liveListener(storeWith(status), probe(true));
    expect(live).toEqual(status);
    expect(chooseBinding(live, {})).toEqual({ port: 4748, host: "127.0.0.1" });
  });

  test("no status file: all interfaces on 4747, COUCH_PORT overrides", async () => {
    const live = await liveListener(storeWith(), probe(true));
    expect(live).toBeUndefined();
    expect(chooseBinding(live, {})).toEqual({ port: 4747 });
    expect(chooseBinding(live, { COUCH_PORT: "4790" })).toEqual({ port: 4790 });
  });

  test("a stale pid, a silent public port or a broken file counts as no listener", async () => {
    expect(await liveListener(storeWith(status), probe(false))).toBeUndefined();
    expect(await liveListener(storeWith(status), probe(true, false))).toBeUndefined();
    expect(await liveListener(storeWith({ pid: 1 }), probe(true))).toBeUndefined();
  });
});

describe("with a listener", () => {
  let h: Harness;
  let dir: string;
  let root: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "couch-listener-store-"));
    root = mkdtempSync(join(tmpdir(), "couch-listener-lib-"));
    mkdirSync(join(root, "Films"));
    writeFileSync(join(root, "Films", "A.Film.2001.mkv"), "");
    new FileStore(dir).write("library", { folders: [root] });
    h = await startHarness(new FileStore(dir), {
      listener: { publicPort: 4747, token: status.token },
    });
  });
  afterEach(async () => {
    await h.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });
  const quit = (headers: Record<string, string> = {}, method = "POST") =>
    fetch(`http://127.0.0.1:${h.app.remote.port}/local/quit`, { method, headers });
  const quits = () => h.mac.calls.filter((c) => c.call === "quit");

  test("the QR code uses the public port", () => {
    expect(h.app.core.pairingUrl).toContain(":4747/?key=");
  });

  test("the right token quits, saving the playing position", async () => {
    const phone = await h.connectPhone();
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok"); // Library
    await focusFolders(h, phone);
    await phone.press("ok"); // the library folder
    await phone.press("ok"); // Films
    await phone.press("ok"); // the video
    expect(h.app.screen().state.view).toBe("player");
    h.player.emit({ type: "duration", seconds: 7200 });
    h.player.emit({ type: "position", seconds: 900 });
    const res = await quit({ authorization: `Bearer ${status.token}` });
    expect(res.status).toBe(200);
    await phone.waitFor(() => quits().length === 1);
    h.app.beforeQuit();
    await h.stop();
    const again = await startHarness(new FileStore(dir));
    expect(again.app.screen().continueCard?.path).toBe(join(root, "Films", "A.Film.2001.mkv"));
    await again.stop();
    h = await startHarness();
  });

  test("no token or a wrong token is refused, and nothing quits", async () => {
    expect((await quit()).status).toBe(401);
    expect((await quit({ authorization: "Bearer nope" })).status).toBe(401);
    expect((await quit({ authorization: `Bearer ${status.token}` }, "GET")).status).toBe(404);
    expect(quits()).toHaveLength(0);
  });

  test("power is ignored", async () => {
    const phone = await h.connectPhone();
    phone.send("power");
    await phone.settle();
    expect(quits()).toHaveLength(0);
  });
});

describe("without a listener", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(() => h.stop());

  test("power quits like Settings → Quit", async () => {
    const phone = await h.connectPhone();
    phone.send("power");
    await phone.waitFor(() => h.mac.calls.some((c) => c.call === "quit"));
  });

  test("/local/quit is not there, and the QR code uses Couch's own port", async () => {
    const res = await fetch(`http://127.0.0.1:${h.app.remote.port}/local/quit`, {
      method: "POST",
      headers: { authorization: "Bearer x" },
    });
    expect(res.status).toBe(404);
    expect(h.app.core.pairingUrl).toContain(`:${h.app.remote.port}/?key=`);
  });

  test("the Remote page is the one the build writes", async () => {
    const res = await fetch(`http://127.0.0.1:${h.app.remote.port}/`);
    expect(await res.text()).toBe(REMOTE_PAGE);
  });
});
