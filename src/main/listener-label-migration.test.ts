import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { LISTENER_LABEL, type Exec } from "./ports/login-item.ts";
import { LEGACY_LISTENER_LABEL, migrateListenerLabel } from "./ports/listener-label-migration.ts";
import { MemoryStore } from "./ports/store.ts";

describe("listener label migration (real files, fake launchctl)", () => {
  let home: string;
  let program: string;
  let store: MemoryStore;
  let calls: string[];
  let loaded: Set<string>;
  const exec: Exec = async (_f, args) => {
    const label = (args[1] ?? "").split("/")[2];
    if (args[0] === "print") return { ok: loaded.has(label) };
    if (args[0] === "bootout") {
      calls.push(`bootout ${label}`);
      loaded.delete(label);
    }
    if (args[0] === "bootstrap") {
      const plist = readFileSync(args[2], "utf8");
      const l = /<key>Label<\/key>\s*<string>([^<]*)</.exec(plist)![1];
      calls.push(`bootstrap ${l}`);
      loaded.add(l);
    }
    return { ok: true };
  };
  const agents = () => join(home, "Library/LaunchAgents");
  const oldPlist = () => join(agents(), `${LEGACY_LISTENER_LABEL}.plist`);
  const newPlist = () => join(agents(), `${LISTENER_LABEL}.plist`);
  const run = () =>
    migrateListenerLabel({ home, uid: 501, program, launch: "open -a X", store, exec });
  const installOld = (on: boolean) => {
    mkdirSync(agents(), { recursive: true });
    writeFileSync(oldPlist(), "old");
    if (on) loaded.add(LEGACY_LISTENER_LABEL);
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "couch-mig-"));
    program = join(home, "couch-listener");
    writeFileSync(program, "");
    store = new MemoryStore();
    calls = [];
    loaded = new Set();
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  test("labels", () => {
    expect(LISTENER_LABEL).toBe("com.abdullahnettoor.couch.listener");
  });

  test("old plist present and on: old booted out first and removed, new registered", async () => {
    installOld(true);
    await run();
    expect(calls.slice(0, 1)).toEqual([`bootout ${LEGACY_LISTENER_LABEL}`]);
    expect(calls).toContain(`bootstrap ${LISTENER_LABEL}`);
    expect(existsSync(oldPlist())).toBe(false);
    expect(readFileSync(newPlist(), "utf8")).toContain("--launch");
    expect([...loaded]).toEqual([LISTENER_LABEL]);
  });

  test("runs once: a second start does nothing", async () => {
    installOld(true);
    await run();
    calls.length = 0;
    installOld(true);
    await run();
    expect(calls).toEqual([]);
    expect(existsSync(oldPlist())).toBe(true);
  });

  test("no old plist: nothing happens", async () => {
    await run();
    expect(calls).toEqual([]);
    expect(existsSync(newPlist())).toBe(false);
  });

  test("old plist but item off: old removed, no new one", async () => {
    installOld(false);
    await run();
    expect(existsSync(oldPlist())).toBe(false);
    expect(existsSync(newPlist())).toBe(false);
    expect(calls.some((c) => c.startsWith("bootstrap"))).toBe(false);
  });

  test("outside an installed Couch.app it leaves everything and retries next time", async () => {
    installOld(true);
    rmSync(program);
    await run();
    expect(calls).toEqual([]);
    expect(existsSync(oldPlist())).toBe(true);
    writeFileSync(program, "");
    await run();
    expect(existsSync(oldPlist())).toBe(false);
  });
});
