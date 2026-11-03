import { describe, expect, test } from "vite-plus/test";
import { FakeClock, FakeUpdater } from "./ports/fakes.ts";
import type { Exec } from "./ports/login-item.ts";
import { MemoryStore } from "./ports/store.ts";
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  UPDATE_READY_TOAST,
  bundleBuild,
  devUpdates,
  readBeta,
  restartListenerAfterUpdate,
  startUpdates,
  updateFeedUrl,
  versionIn,
} from "./ports/updates.ts";

const BETA_FEED =
  "https://github.com/abdullahnettoor/couch/releases/download/beta-feed/beta-darwin-arm64.json";
const STABLE_FEED = (version: string) =>
  `https://update.electronjs.org/abdullahnettoor/couch/darwin-arm64/${version}`;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function start(
  o: {
    version?: string;
    store?: MemoryStore;
    legacyBeta?: () => boolean;
    feed?: () => unknown;
  } = {},
) {
  const updater = new FakeUpdater();
  const clock = new FakeClock();
  const store = o.store ?? new MemoryStore();
  const toasts: string[] = [];
  const logs: string[] = [];
  const fetched: string[] = [];
  const changes = { count: 0 };
  const updates = startUpdates({
    updater,
    clock,
    store,
    platform: "darwin",
    arch: "arm64",
    version: o.version ?? "0.1.0",
    build: "12",
    legacyBeta: o.legacyBeta,
    toast: (t) => toasts.push(t),
    fetchJson: async (url) => {
      fetched.push(url);
      return o.feed ? o.feed() : { version: "0.0.1" };
    },
    log: (m) => logs.push(m),
  });
  updates.onChange(() => changes.count++);
  return { updater, clock, store, toasts, logs, fetched, changes, updates };
}

describe("updates", () => {
  test("asks update.electronjs.org about this repo, platform, arch and version", () => {
    expect(updateFeedUrl({ platform: "darwin", arch: "arm64", version: "0.1.0" })).toBe(
      STABLE_FEED("0.1.0"),
    );
    expect(start().updater.feed).toBe(STABLE_FEED("0.1.0"));
  });

  test("checks a minute after start, then every six hours, until stopped", () => {
    const { updater, clock, updates } = start();
    clock.advance(FIRST_CHECK_MS - 1);
    expect(updater.checks).toBe(0);
    clock.advance(1);
    expect(updater.checks).toBe(1);
    updater.notAvailable();
    clock.advance(CHECK_EVERY_MS);
    updater.notAvailable();
    clock.advance(CHECK_EVERY_MS);
    expect(updater.checks).toBe(3);
    updater.notAvailable();
    updates.stop();
    clock.advance(CHECK_EVERY_MS * 2);
    expect(updater.checks).toBe(3);
  });

  test("a stable check goes idle → checking → downloading → ready, with the version from the release's name", () => {
    const { updater, updates, toasts, changes } = start();
    expect(updates.state()).toEqual({ status: "idle" });
    updates.checkNow();
    expect(updates.state()).toEqual({ status: "checking" });
    updater.checking();
    updater.available();
    expect(updates.state()).toEqual({ status: "downloading" });
    updater.download("Couch 0.1.1");
    expect(updates.state()).toEqual({ status: "ready", version: "0.1.1" });
    expect(toasts).toEqual([UPDATE_READY_TOAST]);
    expect(changes.count).toBeGreaterThanOrEqual(3);
  });

  test("no newer release is Up to date; a failure is failed, and a later check starts again", () => {
    const { updater, updates, logs } = start();
    updates.checkNow();
    updater.notAvailable();
    expect(updates.state()).toEqual({ status: "up-to-date" });
    updates.checkNow();
    updater.fail("offline");
    expect(updates.state()).toEqual({ status: "failed" });
    expect(logs).toEqual(["Update check failed: offline"]);
    updates.checkNow();
    expect(updates.state()).toEqual({ status: "checking" });
    expect(updater.checks).toBe(3);
  });

  test("Check for updates skips the six-hour wait, and does nothing while a check or download is under way", () => {
    const { updater, updates, clock } = start();
    updates.checkNow();
    expect(updater.checks).toBe(1);
    updates.checkNow();
    expect(updater.checks).toBe(1);
    updater.available();
    updates.checkNow();
    clock.advance(FIRST_CHECK_MS);
    expect(updater.checks).toBe(1);
    expect(updates.state().status).toBe("downloading");
  });

  test("a downloaded update is a toast, said once, never a restart", () => {
    const { updater, toasts } = start();
    updater.download();
    updater.download();
    expect(toasts).toEqual([UPDATE_READY_TOAST]);
    expect(updater.installs).toBe(0);
  });

  test("a failed check is only logged", () => {
    const { updater, clock, toasts, logs, updates } = start();
    updater.throwOnCheck = true;
    clock.advance(FIRST_CHECK_MS);
    expect(updates.state()).toEqual({ status: "failed" });
    updater.fail("offline");
    expect(toasts).toEqual([]);
    expect(logs).toEqual(["Update check failed: no network", "Update check failed: offline"]);
  });

  test("a downloaded update ends the checks until Couch restarts", () => {
    const { updater, clock, updates } = start();
    clock.advance(FIRST_CHECK_MS);
    updater.download();
    clock.advance(CHECK_EVERY_MS * 3);
    updates.checkNow();
    expect(updater.checks).toBe(1);
    // An error after the download (a failed install) leaves the update ready.
    updater.fail("ShipIt");
    expect(updates.state().status).toBe("ready");
  });

  test("restart installs only a downloaded update", () => {
    const { updater, updates } = start();
    updates.restart();
    expect(updater.installs).toBe(0);
    updates.checkNow();
    updater.available();
    updates.restart();
    expect(updater.installs).toBe(0);
    updater.download();
    updates.restart();
    expect(updater.installs).toBe(1);
  });

  test("knows its version and build number", () => {
    const { updates } = start();
    expect(updates.installed).toBe(true);
    expect([updates.version, updates.build]).toEqual(["0.1.0", "12"]);
    expect(
      bundleBuild(
        "<dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>0.2.0</string>\n\t<key>CFBundleVersion</key>\n\t<string>12</string>",
      ),
    ).toBe("12");
    expect(bundleBuild("bplist00")).toBeUndefined();
    expect(versionIn("Couch 0.2.0-beta.1")).toBe("0.2.0-beta.1");
    expect(versionIn("Couch")).toBeUndefined();
  });

  test("in a run from the repo, nothing is checked; the version and the Beta updates choice still are", () => {
    const store = new MemoryStore();
    const dev = devUpdates({ store, version: "0.2.0" });
    expect(dev.installed).toBe(false);
    dev.checkNow();
    expect(dev.state()).toEqual({ status: "idle" });
    dev.setBeta(true);
    expect(dev.beta()).toBe(true);
    expect(readBeta(store)).toBe(true);
  });
});

describe("the beta channel", () => {
  function startBeta(version: string, feed: () => unknown) {
    const store = new MemoryStore();
    store.write("updates", { beta: true });
    return start({ version, store, feed });
  }

  test("reads the beta feed file on GitHub, and gives Squirrel that file", async () => {
    const { updater, clock, fetched } = startBeta("0.1.1", () => ({ version: "0.2.0-beta.1" }));
    expect(updater.feed).toBe(BETA_FEED);
    clock.advance(FIRST_CHECK_MS);
    await flush();
    expect(fetched).toEqual([BETA_FEED]);
    expect(updater.checks).toBe(1);
  });

  test("asks Squirrel only for a newer version, never the same or an older one", async () => {
    let version = "0.2.0-beta.1";
    const { updater, clock, updates } = startBeta("0.2.0-beta.1", () => ({ version }));
    clock.advance(FIRST_CHECK_MS);
    await flush();
    expect(updater.checks).toBe(0);
    expect(updates.state()).toEqual({ status: "up-to-date" });
    version = "0.1.1";
    clock.advance(CHECK_EVERY_MS);
    await flush();
    expect(updater.checks).toBe(0);
    // The stable release that follows a beta is newer than the beta.
    version = "0.2.0";
    clock.advance(CHECK_EVERY_MS);
    await flush();
    expect(updater.checks).toBe(1);
  });

  test("the version comes from the feed: downloading and ready name it", async () => {
    const { updater, updates } = startBeta("0.1.1", () => ({ version: "0.2.0-beta.2" }));
    updates.checkNow();
    expect(updates.state()).toEqual({ status: "checking" });
    await flush();
    updater.checking();
    updater.available();
    expect(updates.state()).toEqual({ status: "downloading", version: "0.2.0-beta.2" });
    updater.download("");
    expect(updates.state()).toEqual({ status: "ready", version: "0.2.0-beta.2" });
  });

  test("Check for updates while the feed is being read does nothing", async () => {
    const { updater, updates, fetched } = startBeta("0.1.1", () => ({ version: "0.2.0" }));
    updates.checkNow();
    updates.checkNow();
    await flush();
    expect(fetched).toHaveLength(1);
    expect(updater.checks).toBe(1);
  });

  test("a feed that can't be read or names no version is only logged", async () => {
    let feed: () => unknown = () => {
      throw new Error("HTTP 404");
    };
    const { updater, clock, logs, updates } = startBeta("0.1.1", () => feed());
    clock.advance(FIRST_CHECK_MS);
    await flush();
    expect(updates.state()).toEqual({ status: "failed" });
    feed = () => ({ url: "x" });
    clock.advance(CHECK_EVERY_MS);
    await flush();
    expect(updater.checks).toBe(0);
    expect(logs).toEqual([
      "Update check failed: HTTP 404",
      "Update check failed: the beta feed names no version",
    ]);
  });
});

describe("Beta updates", () => {
  test("is Off unless chosen, and the choice is kept in the Store", () => {
    const store = new MemoryStore();
    const first = start({ store });
    expect(first.updates.beta()).toBe(false);
    first.updates.setBeta(true);
    expect(store.read("updates", {})).toEqual({ beta: true });
    expect(start({ store }).updates.beta()).toBe(true);
  });

  test("the old macOS default turns it On once; after that the stored choice wins", () => {
    const store = new MemoryStore();
    let asked = 0;
    const legacyBeta = () => {
      asked++;
      return true;
    };
    const first = start({ store, legacyBeta });
    expect(first.updates.beta()).toBe(true);
    expect(first.updater.feed).toBe(BETA_FEED);
    expect(store.read("updates", {})).toEqual({ beta: true });
    first.updates.setBeta(false);
    const second = start({ store, legacyBeta });
    expect(second.updates.beta()).toBe(false);
    expect(asked).toBe(1);
  });

  test("without the old default nothing is stored, and the default is still Off", () => {
    const store = new MemoryStore();
    expect(start({ store, legacyBeta: () => false }).updates.beta()).toBe(false);
    expect(store.read("updates", undefined)).toBeUndefined();
  });

  test("switching while idle points Squirrel at the other feed at once, and checks", async () => {
    const { updater, updates, fetched } = start({ feed: () => ({ version: "0.2.0-beta.1" }) });
    updates.setBeta(true);
    expect(updater.feed).toBe(BETA_FEED);
    expect(updates.betaWaits()).toBe(false);
    await flush();
    expect(fetched).toEqual([BETA_FEED]);
    expect(updater.checks).toBe(1);
    updater.notAvailable();
    updates.setBeta(false);
    expect(updater.feed).toBe(STABLE_FEED("0.1.0"));
    expect(updater.checks).toBe(2);
  });

  test("switching during a check waits for it to end, then switches and checks", () => {
    const { updater, updates } = start();
    updates.checkNow();
    updates.setBeta(true);
    expect(updater.feeds).toEqual([STABLE_FEED("0.1.0")]);
    expect(updates.betaWaits()).toBe(false);
    updater.notAvailable();
    expect(updater.feeds).toEqual([STABLE_FEED("0.1.0"), BETA_FEED]);
    expect(updates.state().status).toBe("checking");
  });

  test("switching once an update is ready waits for the next start (Squirrel holds that update)", () => {
    const { updater, updates, store } = start();
    updates.checkNow();
    updater.download("Couch 0.1.1");
    updates.setBeta(true);
    expect(updater.feeds).toEqual([STABLE_FEED("0.1.0")]);
    expect(updates.beta()).toBe(true);
    expect(updates.betaWaits()).toBe(true);
    expect(start({ store }).updater.feed).toBe(BETA_FEED);
  });

  test("Off on a beta version asks update.electronjs.org from that version, which offers only a newer stable", () => {
    const store = new MemoryStore();
    store.write("updates", { beta: true });
    const { updater, updates } = start({ version: "0.2.0-beta.1", store });
    updates.setBeta(false);
    // update.electronjs.org answers "no update" unless its newest release is newer than this version.
    expect(updater.feed).toBe(STABLE_FEED("0.2.0-beta.1"));
  });
});

describe("restartListenerAfterUpdate", () => {
  const recorder = (ok = true) => {
    const calls: string[][] = [];
    const exec: Exec = async (file, args) => {
      calls.push([file, ...args]);
      return { ok, code: ok ? 0 : 3 };
    };
    return { calls, exec };
  };

  test("restarts a running Listener on the first start of a new version, and only then", async () => {
    const store = new MemoryStore();
    store.write("listener-version", { version: "0.1.0" });
    const { calls, exec } = recorder();
    const o = { store, version: "0.1.1", uid: 501, listenerOn: async () => true, exec };
    expect(await restartListenerAfterUpdate(o)).toBe("restarted");
    expect(calls).toEqual([
      ["launchctl", "kickstart", "-k", "gui/501/com.abdullahnettoor.couch.listener"],
    ]);
    expect(await restartListenerAfterUpdate(o)).toBe("unchanged");
    expect(calls).toHaveLength(1);
  });

  test("leaves a Listener that is off alone, and remembers the version", async () => {
    const store = new MemoryStore();
    const { calls, exec } = recorder();
    const o = { store, version: "0.1.1", uid: 501, listenerOn: async () => false, exec };
    expect(await restartListenerAfterUpdate(o)).toBe("off");
    expect(calls).toEqual([]);
    expect(await restartListenerAfterUpdate({ ...o, listenerOn: async () => true })).toBe(
      "unchanged",
    );
  });

  test("a failed restart is retried next start", async () => {
    const store = new MemoryStore();
    const failing = recorder(false);
    const o = { store, version: "0.1.1", uid: 501, listenerOn: async () => true };
    await expect(restartListenerAfterUpdate({ ...o, exec: failing.exec })).rejects.toThrow(
      "kickstart failed (exit 3)",
    );
    const working = recorder();
    expect(await restartListenerAfterUpdate({ ...o, exec: working.exec })).toBe("restarted");
  });
});
