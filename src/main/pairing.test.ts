import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "couch-store-"));
  h = await startHarness(new FileStore(dir));
});
afterEach(async () => {
  await h.stop();
  rmSync(dir, { recursive: true, force: true });
});

const focused = (hh: Harness) => hh.screen.last.focusedLabel;

function tryConnect(port: number, key?: string): Promise<"open" | "refused"> {
  const q = key === undefined ? "" : `?key=${key}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${q}`);
  return new Promise((resolve) => {
    ws.once("open", () => {
      ws.close();
      resolve("open");
    });
    ws.once("error", () => resolve("refused"));
    ws.once("unexpected-response", () => resolve("refused"));
  });
}

describe("pairing", () => {
  test("the QR code carries the .local name, port and key", () => {
    const url = new URL(h.screen.last.pairingUrl);
    expect(url.hostname).toBe("test-mac.local");
    expect(url.port).toBe(String(h.app.remote.port));
    expect(url.searchParams.get("key")).toBe(h.pairingKey());
    expect(h.pairingKey().length).toBeGreaterThan(15);
  });

  test("the current key is accepted; missing and wrong keys are refused", async () => {
    const port = h.app.remote.port;
    expect(await tryConnect(port, h.pairingKey())).toBe("open");
    expect(await tryConnect(port)).toBe("refused");
    expect(await tryConnect(port, "nope")).toBe("refused");
  });

  test("the Remote page itself is served without a key", async () => {
    const res = await fetch(`http://127.0.0.1:${h.app.remote.port}/`);
    expect(res.status).toBe(200);
  });

  test("the key survives a restart", async () => {
    const key = h.pairingKey();
    await h.stop();
    h = await startHarness(new FileStore(dir));
    expect(h.pairingKey()).toBe(key);
    expect(await tryConnect(h.app.remote.port, key)).toBe("open");
  });

  test("a phone connecting shows the count and a Phone connected note", async () => {
    expect(h.screen.last.state.remotes).toBe(0);
    const phone = await h.connectPhone();
    expect(h.screen.last.state.remotes).toBe(1);
    expect(h.screen.last.state.toast).toBe("Phone connected");
    h.clock.advance(3500);
    expect(h.screen.last.state.toast).toBeUndefined();
    await h.connectPhone();
    expect(h.screen.last.state.remotes).toBe(2);
    expect(phone.last?.remotes).toBe(2);
  });

  test("two phones receive identical snapshots and either one moves focus", async () => {
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    await a.settle();
    await b.settle();
    await a.press("right");
    await b.waitFor(() => b.last?.view === "home");
    await b.press("left");
    expect(focused(h)).toBe("YouTube");
    await a.settle();
    expect(a.last).toEqual(b.last);
  });
});

describe("Settings", () => {
  async function openSettings() {
    const phone = await h.connectPhone();
    await phone.press("up");
    expect(focused(h)).toBe("Settings");
    await phone.press("ok");
    return phone;
  }

  test("Up from Home focuses the gear and OK opens exactly the settings items", async () => {
    await openSettings();
    expect(h.screen.last.state.view).toBe("settings");
    expect(h.screen.last.grid.map((i) => i.label)).toEqual([
      "Add a phone",
      "Forget all phones",
      "Library folders",
      "Show and film details",
      "Sound output",
      "Start Couch Listener at login",
      "Restart YouTube",
      "Quit Couch",
    ]);
  });

  test("Back from Settings returns Home; Back on Home does nothing", async () => {
    const phone = await openSettings();
    const snap = await phone.press("back");
    expect(snap.where).toBe("Home");
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("home");
  });

  test("Add a phone shows the QR code view, Back returns to Settings", async () => {
    const phone = await openSettings();
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("addPhone");
    expect(h.screen.last.pairingUrl).toContain("?key=");
    await phone.press("back");
    expect(h.screen.last.state.view).toBe("settings");
  });

  test("Quit Couch asks, then quits", async () => {
    const phone = await openSettings();
    for (let i = 0; i < 7; i++) await phone.press("down");
    await phone.press("ok");
    await phone.press("right");
    await phone.press("ok");
    expect(h.mac.calls.some((c) => c.call === "quit")).toBe(true);
  });

  test("Forget all phones replaces the key, drops everyone and shows the new QR", async () => {
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    const oldKey = h.pairingKey();
    await a.press("up");
    await a.press("ok");
    await a.press("down");
    const closed = Promise.all([a, b].map((p) => new Promise<void>((r) => p.closed(r))));
    a.send("ok");
    await closed;
    const newKey = h.pairingKey();
    expect(newKey).not.toBe(oldKey);
    expect(h.screen.last.state.remotes).toBe(0);
    expect(h.screen.last.state.view).toBe("addPhone");
    expect(h.screen.last.pairingUrl).toContain(newKey);
    expect(await tryConnect(h.app.remote.port, oldKey)).toBe("refused");
    expect(await tryConnect(h.app.remote.port, newKey)).toBe("open");
    await h.stop();
    h = await startHarness(h.store);
    expect(h.pairingKey()).toBe(newKey);
  });
});
