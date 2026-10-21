import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { createLoginItem, type Exec } from "./ports/login-item.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

describe("login item (real files, fake launchctl)", () => {
  let home: string;
  let calls: string[][];
  let loaded: boolean;
  const exec: Exec = async (_file, args) => {
    calls.push(args);
    if (args[0] === "bootstrap") loaded = true;
    if (args[0] === "bootout") loaded = false;
    return { ok: args[0] === "print" ? loaded : true };
  };
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "couch-login-"));
    calls = [];
    loaded = false;
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const PROGRAM = "/Apps/Couch.app/Contents/Resources/couch-listener";
  const make = (program: string | undefined) =>
    createLoginItem({ home, uid: 501, program, launch: "open -a '/Apps/Couch.app'", exec });

  test("on writes the plist and bootstraps; off boots out and removes it", async () => {
    const item = make(PROGRAM);
    await item.set(true);
    const plist = readFileSync(item.plistPath, "utf8");
    expect(item.plistPath).toBe(join(home, "Library/LaunchAgents/local.couch.listener.plist"));
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<string>/Apps/Couch.app/Contents/Resources/couch-listener</string>");
    expect(plist).toContain(join(home, "Library/Logs/Couch/listener.log"));
    expect(calls.at(-1)).toEqual(["bootstrap", "gui/501", item.plistPath]);
    expect(await item.state()).toEqual({ available: true, on: true });
    expect(calls.at(-1)).toEqual(["print", "gui/501/local.couch.listener"]);
    await item.set(false);
    expect(calls.at(-1)).toEqual(["bootout", "gui/501/local.couch.listener"]);
    expect(existsSync(item.plistPath)).toBe(false);
    expect(await item.state()).toEqual({ available: true, on: false });
  });

  test("in development it is unavailable and does nothing", async () => {
    const item = make(undefined);
    await item.set(true);
    expect(calls).toEqual([]);
    expect(existsSync(item.plistPath)).toBe(false);
    expect(await item.state()).toEqual({ available: false, on: false });
  });
});

describe("Settings item", () => {
  let h: Harness;
  afterEach(() => h?.stop());

  async function toSettings(phone: Awaited<ReturnType<Harness["connectPhone"]>>) {
    await phone.press("home");
    await phone.press("down");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("up");
    await phone.press("ok");
  }

  async function openSettings() {
    h = await startHarness();
    const phone = await h.connectPhone();
    await toSettings(phone);
    expect(h.screen.last.state.view).toBe("settings");
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
