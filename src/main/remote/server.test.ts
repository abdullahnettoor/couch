import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "../ports/store.ts";
import { startHarness, type Harness } from "../testing/harness.ts";
import { MAX_MESSAGE, parseCommand } from "./server.ts";

const raw = (command: string, args?: unknown) => JSON.stringify({ type: "command", command, args });

describe("parseCommand limits", () => {
  test("small commands still parse with their own fields", () => {
    expect(parseCommand(raw("seekBy", { seconds: -10 }))?.args).toEqual({ seconds: -10 });
    expect(parseCommand(raw("setTrack", { kind: "audio", track: "en" }))?.args).toEqual({
      kind: "audio",
      track: "en",
    });
    expect(parseCommand(raw("typeText", { text: "dune" }))?.args).toEqual({ text: "dune" });
    expect(parseCommand(raw("ok"))).toEqual({ command: "ok" });
    expect(parseCommand(raw("ok", {}))).toEqual({ command: "ok", args: {} });
  });

  test("text, addon and track strings are capped at 4 KiB", () => {
    expect(parseCommand(raw("typeText", { text: "a".repeat(4096) }))).toBeDefined();
    expect(parseCommand(raw("typeText", { text: "a".repeat(4097) }))).toBeUndefined();
    expect(parseCommand(raw("typeText", { text: "é".repeat(2049) }))).toBeUndefined();
    expect(parseCommand(raw("toggleAddon", { addon: "x".repeat(4097) }))).toBeUndefined();
    expect(
      parseCommand(raw("setTrack", { kind: "audio", track: "x".repeat(4097) })),
    ).toBeUndefined();
  });

  test("no command takes a photo's data", () => {
    expect(parseCommand(raw("typeText", { data: "AAEC" }))).toBeUndefined();
    expect(parseCommand(raw("typeText", { text: "a".repeat(5000) }))).toBeUndefined();
  });

  test("unknown fields and wrong types reject the whole command", () => {
    expect(parseCommand(raw("seekBy", { seconds: 5, extra: 1 }))).toBeUndefined();
    expect(parseCommand(raw("ok", { text: "x" }))).toBeUndefined();
    expect(parseCommand(raw("seekBy", { seconds: "5" }))).toBeUndefined();
    expect(parseCommand(raw("typeText", { text: 42 }))).toBeUndefined();
    expect(
      parseCommand(raw("typeText", { __proto__: { x: 1 }, text: "AA", y: 2 })),
    ).toBeUndefined();
  });

  test("the transport ceiling is the Listener's 1 MiB", () => {
    expect(MAX_MESSAGE).toBe(1 << 20);
  });
});

describe("an oversize message", () => {
  let h: Harness | undefined;
  let dir = "";
  afterEach(async () => {
    await h?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
    h = undefined;
  });

  test("closes only that socket; Couch and the other Remotes keep working", async () => {
    dir = mkdtempSync(join(tmpdir(), "couch-srv-"));
    h = await startHarness(new FileStore(dir));
    const other = await h.connectPhone();
    const url = `ws://127.0.0.1:${h.app.remote.port}/ws?key=${encodeURIComponent(h.pairingKey())}`;
    const bad = new WebSocket(url);
    await new Promise((res, rej) => (bad.once("open", res), bad.once("error", rej)));
    const closed = new Promise<number>((res) => bad.once("close", (code) => res(code)));
    bad.on("error", () => {});
    bad.send("x".repeat(MAX_MESSAGE + 1));
    expect(await closed).toBe(1009);
    const snap = await other.press("down");
    expect(snap).toBeDefined();
    const late = await h.connectPhone();
    expect(await late.press("down")).toBeDefined();
  });
});
