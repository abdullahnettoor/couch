import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { MAX_PHOTO_DATA } from "../../shared/wallpapers.ts";
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

  test("a photo's data gets the photo allowance, and no other command does", () => {
    const max = "A".repeat(MAX_PHOTO_DATA);
    expect(parseCommand(raw("addPhoto", { data: max }))?.args?.data).toBe(max);
    expect(parseCommand(raw("addPhoto", { data: max + "A" }))).toBeUndefined();
    expect(parseCommand(raw("typeText", { data: "AAEC" }))).toBeUndefined();
    expect(parseCommand(raw("typeText", { text: "a".repeat(5000) }))).toBeUndefined();
  });

  test("unknown fields and wrong types reject the whole command", () => {
    expect(parseCommand(raw("seekBy", { seconds: 5, extra: 1 }))).toBeUndefined();
    expect(parseCommand(raw("ok", { text: "x" }))).toBeUndefined();
    expect(parseCommand(raw("seekBy", { seconds: "5" }))).toBeUndefined();
    expect(parseCommand(raw("addPhoto", { data: 42 }))).toBeUndefined();
    expect(parseCommand(raw("addPhoto", { __proto__: { x: 1 }, data: "AA", y: 2 }))).toBeUndefined();
  });

  test("the transport ceiling fits a photo, and is no lower than the old 1 MiB cap", () => {
    expect(MAX_MESSAGE).toBeGreaterThanOrEqual(1 << 20);
    expect(MAX_MESSAGE).toBeGreaterThan(raw("addPhoto", { data: "A".repeat(MAX_PHOTO_DATA) }).length);
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
