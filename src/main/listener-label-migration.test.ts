import { beforeEach, describe, expect, test } from "vite-plus/test";
import { LISTENER_LABEL, type Exec } from "./ports/login-item.ts";
import { LEGACY_LISTENER_LABEL, migrateListenerLabel } from "./ports/listener-label-migration.ts";
import { MemoryStore } from "./ports/store.ts";

const HOME = "/home/test";
const AGENTS = `${HOME}/Library/LaunchAgents`;
const OLD = `${AGENTS}/${LEGACY_LISTENER_LABEL}.plist`;
const NEW = `${AGENTS}/${LISTENER_LABEL}.plist`;
const UID = 501;

const OLD_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LEGACY_LISTENER_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/Couch.app/Contents/Resources/couch-listener</string>
    <string>--launch</string>
    <string>open -a '/Applications/Couch.app'</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COUCH_PORT</key>
    <string>4747</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>7</integer>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;

/** Fakes for launchctl, the file system, the port probe and time. Nothing real is touched. */
class World {
  events: string[] = [];
  files = new Map<string, string>();
  loaded = new Set<string>();
  disabled = new Set<string>();
  /** How long after bootstrap a job starts answering on the port, in fake ms. */
  startDelay = new Map<string, number>();
  /** A job that never lets go of the port, even once booted out. */
  portStuck = false;
  startedAt = new Map<string, number>();
  failures = new Map<string, number>();
  fsFailures = new Set<string>();
  store = new MemoryStore();
  now = 0;
  logs: string[] = [];

  constructor() {
    const write = this.store.write.bind(this.store);
    this.store.write = ((key: string, value: unknown) => {
      this.events.push(`marker ${key}`);
      return write(key, value as never);
    }) as typeof this.store.write;
  }

  labelOf = (arg: string) => arg.split("/").pop()!;
  exec: Exec = async (_file, args) => {
    const [verb, target] = args;
    if (verb === "print-disabled") {
      const out = [...this.disabled].map((l) => `"${l}" => disabled`).join("\n");
      return this.fail("print-disabled") ?? { ok: true, code: 0, output: `{\n${out}\n}` };
    }
    if (verb === "print") return { ok: this.loaded.has(this.labelOf(target)), code: 0 };
    if (verb === "bootout") {
      const label = this.labelOf(target);
      this.events.push(`bootout ${label === LISTENER_LABEL ? "new" : "old"}`);
      const failed = this.fail(`bootout ${label}`);
      if (failed) return failed;
      if (!this.loaded.has(label)) return { ok: false, code: 3 };
      this.loaded.delete(label);
      return { ok: true, code: 0 };
    }
    if (verb === "bootstrap") {
      const label = /<string>([^<]*)<\/string>/.exec(this.files.get(args[2]) ?? "")?.[1] ?? "?";
      this.events.push(`bootstrap ${label === LISTENER_LABEL ? "new" : "old"}`);
      const failed = this.fail(`bootstrap ${label}`);
      if (failed) return failed;
      if (this.loaded.has(label)) return { ok: false, code: 5 };
      this.loaded.add(label);
      this.startedAt.set(label, this.now);
      return { ok: true, code: 0 };
    }
    if (verb === "kickstart") {
      const label = this.labelOf(args[args.length - 1]);
      this.events.push(`kickstart ${label === LISTENER_LABEL ? "new" : "old"}`);
      return this.fail(`kickstart ${label}`) ?? { ok: this.loaded.has(label), code: 0 };
    }
    return { ok: false, code: 1 };
  };
  fail(command: string) {
    const code = this.failures.get(command);
    return code === undefined ? undefined : { ok: false, code };
  }

  up(label: string) {
    return (
      this.loaded.has(label) &&
      this.now - (this.startedAt.get(label) ?? 0) >= (this.startDelay.get(label) ?? 0)
    );
  }
  probe = {
    pidExists: () => true,
    portAnswers: async () => {
      const answers = this.portStuck || this.up(LEGACY_LISTENER_LABEL) || this.up(LISTENER_LABEL);
      this.events.push(answers ? "probe:up" : "probe:free");
      return answers;
    },
  };

  check(op: string, path: string) {
    if (this.fsFailures.has(`${op} ${path}`)) throw new Error(`EIO: ${op} ${path}`);
  }
  fs = {
    exists: (p: string) => this.files.has(p),
    read: (p: string) => {
      this.check("read", p);
      const text = this.files.get(p);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    write: (p: string, text: string) => {
      this.check("write", p);
      this.files.set(p, text);
      this.events.push(`write ${p === NEW ? "new" : p}`);
    },
    remove: (p: string) => {
      this.check("remove", p);
      this.files.delete(p);
      this.events.push(`delete ${p === OLD ? "old" : p === NEW ? "new" : p}`);
    },
  };

  /** An old listener that was set up by the household. */
  install(o: { loaded: boolean; disabled?: boolean }) {
    this.files.set(OLD, OLD_PLIST);
    if (o.loaded) this.loaded.add(LEGACY_LISTENER_LABEL);
    if (o.disabled) this.disabled.add(LEGACY_LISTENER_LABEL);
  }

  toasts: string[] = [];
  run() {
    return migrateListenerLabel({
      home: HOME,
      uid: UID,
      available: true,
      store: this.store,
      exec: this.exec,
      probe: this.probe,
      fs: this.fs,
      sleep: async (ms) => void (this.now += ms),
      log: (m) => this.logs.push(m),
    });
  }
  marked = () => this.store.read<{ listenerLabel?: boolean }>("migrations", {}).listenerLabel;
  /** Consecutive duplicates collapsed, plist writes left out. */
  order = () => this.events.filter((e, i, all) => e !== all[i - 1] && !e.startsWith("write"));
}

describe("listener label migration (fake launchctl, file system and port)", () => {
  let w: World;
  beforeEach(() => (w = new World()));

  const rolledBack = () => {
    expect(w.files.has(NEW)).toBe(false);
    expect(w.files.get(OLD)).toBe(OLD_PLIST);
    expect(w.loaded.has(LISTENER_LABEL)).toBe(false);
    expect(w.loaded.has(LEGACY_LISTENER_LABEL)).toBe(true);
    expect(w.marked()).toBeUndefined();
  };

  test("success: bootout, bootstrap, kickstart, verify, delete old, marker; settings and port kept", async () => {
    w.install({ loaded: true });
    expect(await w.run()).toBe("migrated");
    expect(w.order()).toEqual([
      "bootout old",
      "probe:free",
      "bootstrap new",
      "kickstart new",
      "probe:up",
      "delete old",
      "marker migrations",
    ]);
    expect(w.files.get(NEW)).toBe(OLD_PLIST.replace(LEGACY_LISTENER_LABEL, LISTENER_LABEL));
    expect(w.files.has(OLD)).toBe(false);
    expect([...w.loaded]).toEqual([LISTENER_LABEL]);
    expect(w.marked()).toBe(true);
    expect(w.logs).toEqual(["Listener label migrated to " + LISTENER_LABEL]);
  });

  test("enabled but not loaded right now: it migrates and the new job runs", async () => {
    w.install({ loaded: false });
    expect(await w.run()).toBe("migrated");
    expect([...w.loaded]).toEqual([LISTENER_LABEL]);
    expect(w.files.has(OLD)).toBe(false);
    expect(w.marked()).toBe(true);
  });

  test("explicitly disabled: the old plist is removed, nothing new is registered, marker written", async () => {
    w.install({ loaded: false, disabled: true });
    expect(await w.run()).toBe("removed");
    expect(w.files.has(OLD)).toBe(false);
    expect(w.files.has(NEW)).toBe(false);
    expect(w.events.some((e) => e.startsWith("bootstrap"))).toBe(false);
    expect(w.marked()).toBe(true);
  });

  test("already migrated: nothing happens", async () => {
    w.store.write("migrations", { listenerLabel: true });
    w.events.length = 0;
    w.install({ loaded: true });
    expect(await w.run()).toBe("skipped");
    expect(w.events).toEqual([]);
    expect(w.files.has(OLD)).toBe(true);
  });

  test("no old plist: nothing happens, and the marker is written", async () => {
    expect(await w.run()).toBe("skipped");
    expect(w.order()).toEqual(["marker migrations"]);
  });

  test("outside an installed Couch.app it leaves everything and writes no marker", async () => {
    w.install({ loaded: true });
    const result = await migrateListenerLabel({
      home: HOME,
      uid: UID,
      available: false,
      store: w.store,
      exec: w.exec,
      probe: w.probe,
      fs: w.fs,
      log: () => {},
    });
    expect(result).toBe("skipped");
    expect(w.events).toEqual([]);
    expect(w.marked()).toBeUndefined();
  });

  test("bootout failing (not a not-found code): rollback, old still running, quiet toast result", async () => {
    w.install({ loaded: true });
    w.failures.set(`bootout ${LEGACY_LISTENER_LABEL}`, 1);
    expect(await w.run()).toBe("rolled-back");
    rolledBack();
    expect(w.logs.join("\n")).toMatch(/bootout/);
  });

  test("bootout reporting not-loaded is fine", async () => {
    w.install({ loaded: false });
    w.failures.set(`bootout ${LEGACY_LISTENER_LABEL}`, 113);
    expect(await w.run()).toBe("migrated");
  });

  test("bootstrap failing: rollback with the old job running again", async () => {
    w.install({ loaded: true });
    w.failures.set(`bootstrap ${LISTENER_LABEL}`, 5);
    expect(await w.run()).toBe("rolled-back");
    rolledBack();
    expect(w.order()).toContain("bootstrap old");
    expect(w.order().at(-1)).toBe("kickstart old");
    expect(w.logs.join("\n")).toMatch(/bootstrap/);
  });

  test("kickstart failing: rollback", async () => {
    w.install({ loaded: true });
    w.failures.set(`kickstart ${LISTENER_LABEL}`, 1);
    expect(await w.run()).toBe("rolled-back");
    rolledBack();
  });

  test("readiness timing out: rollback", async () => {
    w.install({ loaded: true });
    w.startDelay.set(LISTENER_LABEL, 60_000);
    expect(await w.run()).toBe("rolled-back");
    rolledBack();
    expect(w.now).toBeGreaterThanOrEqual(5000);
    expect(w.now).toBeLessThan(10_000);
    expect(w.order()).toContain("bootout new");
  });

  test("a delayed start within the window still succeeds", async () => {
    w.install({ loaded: true });
    w.startDelay.set(LISTENER_LABEL, 3000);
    expect(await w.run()).toBe("migrated");
  });

  test("the port staying busy after bootout: rollback without ever registering the new job", async () => {
    w.install({ loaded: true });
    w.portStuck = true;
    expect(await w.run()).toBe("rolled-back");
    expect(w.events.some((e) => e === "bootstrap new")).toBe(false);
    expect(w.files.has(NEW)).toBe(false);
    expect(w.loaded.has(LEGACY_LISTENER_LABEL)).toBe(true);
    expect(w.marked()).toBeUndefined();
    expect(w.now).toBeGreaterThanOrEqual(3000);
    expect(w.now).toBeLessThan(5000);
  });

  test("the file system throwing while writing the new plist: rollback", async () => {
    w.install({ loaded: true });
    w.fsFailures.add(`write ${NEW}`);
    expect(await w.run()).toBe("rolled-back");
    rolledBack();
    expect(w.logs.join("\n")).toMatch(/EIO/);
  });

  test("the file system throwing while reading the old plist: rollback, nothing registered", async () => {
    w.install({ loaded: true });
    w.fsFailures.add(`read ${OLD}`);
    expect(await w.run()).toBe("rolled-back");
    rolledBack();
    expect(w.events.some((e) => e === "bootout old")).toBe(false);
  });

  test("print-disabled failing: nothing is touched, retried next start", async () => {
    w.install({ loaded: true });
    w.failures.set("print-disabled", 1);
    expect(await w.run()).toBe("rolled-back");
    expect(w.files.get(OLD)).toBe(OLD_PLIST);
    expect(w.loaded.has(LEGACY_LISTENER_LABEL)).toBe(true);
    expect(w.marked()).toBeUndefined();
  });

  test("a retry after a rollback succeeds", async () => {
    w.install({ loaded: true });
    w.failures.set(`bootstrap ${LISTENER_LABEL}`, 5);
    expect(await w.run()).toBe("rolled-back");
    w.failures.clear();
    w.events.length = 0;
    expect(await w.run()).toBe("migrated");
    expect([...w.loaded]).toEqual([LISTENER_LABEL]);
    expect(w.files.has(OLD)).toBe(false);
    expect(w.marked()).toBe(true);
  });
});
