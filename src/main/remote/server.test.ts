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
    expect(parseCommand(raw("confirmAnswer", { index: 2, text: "Q?" }))?.args).toEqual({
      index: 2,
      text: "Q?",
    });
    expect(parseCommand(raw("confirmAnswer", { index: "2" }))).toBeUndefined();
    expect(parseCommand(raw("confirmAt", { index: 1 }))).toBeUndefined();
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

  test("pointer commands take only the numbers and the switch they are for", () => {
    expect(parseCommand(raw("pointerMode", { on: true }))?.args).toEqual({ on: true });
    expect(parseCommand(raw("pointerMode", { on: "yes" }))).toBeUndefined();
    expect(parseCommand(raw("pointerMove", { dx: 3, dy: -4.5 }))?.args).toEqual({
      dx: 3,
      dy: -4.5,
    });
    expect(parseCommand(raw("pointerMove", { dx: "3", dy: 1 }))).toBeUndefined();
    expect(
      parseCommand(`{"type":"command","command":"pointerMove","args":{"dx":1e999,"dy":0}}`),
    ).toBeUndefined();
    expect(parseCommand(raw("pointerMove", { dx: 1, dy: 1, x: 5 }))).toBeUndefined();
    expect(parseCommand(raw("pointerScroll", { dx: 0, dy: -24.5 }))?.args).toEqual({
      dx: 0,
      dy: -24.5,
    });
    expect(parseCommand(raw("pointerScroll", { dx: "1", dy: 0 }))).toBeUndefined();
    expect(
      parseCommand(`{"type":"command","command":"pointerScroll","args":{"dx":0,"dy":1e999}}`),
    ).toBeUndefined();
    expect(parseCommand(raw("pointerScroll", { dx: 0, dy: 1, z: 2 }))).toBeUndefined();
    expect(parseCommand(raw("pointerClick"))).toEqual({ command: "pointerClick" });
    expect(parseCommand(raw("pointerRightClick", { dx: 1 }))).toBeUndefined();
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

describe("a flood of pointer messages from one phone", () => {
  let h: Harness;
  afterEach(() => h.stop());

  test("is summed and delivered once per frame, in order with the clicks that follow it", async () => {
    h = await startHarness();
    const handled: Array<{ command: string; args?: { dx?: number; dy?: number } }> = [];
    const core = h.app.core;
    const handle = core.handle.bind(core);
    core.handle = (command, from) => {
      if (command.command.startsWith("pointer")) handled.push(command);
      handle(command, from);
    };
    const url = `ws://127.0.0.1:${h.app.remote.port}/ws?key=${encodeURIComponent(h.pairingKey())}`;
    const ws = new WebSocket(url);
    await new Promise((r) => ws.once("open", r));
    const send = (command: string, args?: unknown) => ws.send(raw(command, args));
    for (let i = 0; i < 500; i++) {
      send("pointerMove", { dx: 1, dy: 2 });
      send("pointerScroll", { dx: 0, dy: -1 });
    }
    send("pointerClick");
    await new Promise((r) => setTimeout(r, 120));
    ws.close();

    const moves = handled.filter((c) => c.command === "pointerMove");
    const scrolls = handled.filter((c) => c.command === "pointerScroll");
    expect(moves.length).toBeLessThan(30);
    expect(scrolls.length).toBeLessThan(30);
    expect(moves.reduce((n, c) => n + c.args!.dx!, 0)).toBe(500);
    expect(moves.reduce((n, c) => n + c.args!.dy!, 0)).toBe(1000);
    expect(scrolls.reduce((n, c) => n + c.args!.dy!, 0)).toBe(-500);
    expect(handled.at(-1)?.command).toBe("pointerClick");
  });
});
