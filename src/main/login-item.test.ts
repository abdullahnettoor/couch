import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { createLoginItem, type Exec } from "./ports/login-item.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

/** Reads the few plist keys that matter, whatever the whitespace. */
function readPlist(xml: string) {
  const strings = (block: string) =>
    [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  const flag = (key: string) =>
    new RegExp(`<key>${key}</key>\\s*<true\\s*/>`).test(xml) ? true : undefined;
  return {
    label: /<key>Label<\/key>\s*<string>([^<]*)<\/string>/.exec(xml)?.[1],
    args: strings(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? ""),
    runAtLoad: flag("RunAtLoad"),
    keepAlive: flag("KeepAlive"),
    log: /<key>StandardErrorPath<\/key>\s*<string>([^<]*)<\/string>/.exec(xml)?.[1],
  };
}

describe("login item (real files, fake launchctl)", () => {
  let home: string;
  /** What launchctl has loaded: the plist as it was when bootstrapped. */
  let loaded: string | undefined;
  const exec: Exec = async (_file, args) => {
    if (args[0] === "bootstrap") loaded = readFileSync(args[2], "utf8");
    if (args[0] === "bootout") loaded = undefined;
    return { ok: args[0] === "print" ? loaded !== undefined : true };
  };
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "couch-login-"));
    loaded = undefined;
    PROGRAM = join(home, "Couch.app/Contents/Resources/couch-listener");
    mkdirSync(join(PROGRAM, ".."), { recursive: true });
    writeFileSync(PROGRAM, "");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  let PROGRAM: string;
  const LAUNCH = "open -a '/Apps/Couch.app'";
  const make = (program: string | undefined) =>
    createLoginItem({ home, uid: 501, program, launch: LAUNCH, exec });

  test("on loads a LaunchAgent that runs the listener at login and keeps it alive; off unloads and removes it", async () => {
    const item = make(PROGRAM);
    expect(await item.state()).toEqual({ available: true, on: false });
    await item.set(true);
    expect(loaded).toBeDefined();
    expect(readPlist(loaded!)).toEqual({
      label: "com.abdullahnettoor.couch.listener",
      args: [PROGRAM, "--launch", LAUNCH],
      runAtLoad: true,
      keepAlive: true,
      log: join(home, "Library/Logs/Couch/listener.log"),
    });
    expect(item.plistPath).toBe(
      join(home, "Library/LaunchAgents/com.abdullahnettoor.couch.listener.plist"),
    );
    expect(existsSync(item.plistPath)).toBe(true);
    expect(await item.state()).toEqual({ available: true, on: true });
    await item.set(false);
    expect(loaded).toBeUndefined();
    expect(existsSync(item.plistPath)).toBe(false);
    expect(await item.state()).toEqual({ available: true, on: false });
  });

  test("turning it on twice leaves one loaded agent", async () => {
    const item = make(PROGRAM);
    await item.set(true);
    await item.set(true);
    expect(await item.state()).toEqual({ available: true, on: true });
  });

  test("in development it is unavailable and does nothing", async () => {
    const item = make(undefined);
    await item.set(true);
    expect(loaded).toBeUndefined();
    expect(existsSync(item.plistPath)).toBe(false);
    expect(await item.state()).toEqual({ available: false, on: false });
  });
});

describe("login item without a bundled listener", () => {
  test("a development copy of Electron renamed to Couch has no listener binary: unavailable, nothing written", async () => {
    const home = mkdtempSync(join(tmpdir(), "couch-login-"));
    const calls: string[][] = [];
    const exec: Exec = async (_f, args) => (calls.push(args), { ok: true });
    const item = createLoginItem({
      home,
      uid: 501,
      program: join(home, "Couch.app/Contents/Resources/couch-listener"),
      launch: "open -a x",
      exec,
    });
    expect(await item.state()).toEqual({ available: false, on: false });
    await item.set(true);
    expect(existsSync(item.plistPath)).toBe(false);
    expect(calls).toEqual([]);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("Settings item", () => {
  let h: Harness;
  afterEach(() => h?.stop());

  async function toSettings(phone: Awaited<ReturnType<Harness["connectPhone"]>>) {
    await phone.press("home");
    await phone.press("down");
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("up");
    await phone.press("ok");
    await phone.press("ok");
  }

  async function openSettings() {
    h = await startHarness();
    const phone = await h.connectPhone();
    await toSettings(phone);
    expect(h.screen.last.state.view).toBe("settingsRemotes");
    while (h.screen.last.focusedId !== "listener") await phone.press("down");
    await phone.settle();
    return phone;
  }

  test("OK turns the login item on and off; Settings shows it", async () => {
    const phone = await openSettings();
    expect(h.screen.last.listener).toEqual({ available: true, on: false, running: false });
    await phone.press("ok");
    await phone.settle();
    expect(h.mac.calls.filter((c) => c.call === "setListenerLoginItem")).toEqual([
      { call: "setListenerLoginItem", args: [true] },
    ]);
    expect(h.screen.last.listener?.on).toBe(true);
    await phone.press("ok");
    await phone.settle();
    expect(h.mac.calls.at(-1)).toEqual({ call: "setListenerLoginItem", args: [false] });
    expect(h.screen.last.listener?.on).toBe(false);
  });

  test("in development it is unavailable and OK does nothing", async () => {
    const phone = await openSettings();
    h.mac.loginItem.available = false;
    await h.app.core.refreshLoginItem();
    expect(h.screen.last.listener?.available).toBe(false);
    await phone.press("ok");
    await phone.settle();
    expect(h.mac.calls.some((c) => c.call === "setListenerLoginItem")).toBe(false);
  });

  test("a live listener shows as running", async () => {
    h = await startHarness(undefined, { listener: { publicPort: 4790, token: "t" } });
    const phone = await h.connectPhone();
    await toSettings(phone);
    expect(h.screen.last.listener?.running).toBe(true);
  });
});
