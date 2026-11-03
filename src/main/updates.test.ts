import { describe, expect, test } from "vite-plus/test";
import { FakeClock } from "./ports/fakes.ts";
import type { Exec } from "./ports/login-item.ts";
import { MemoryStore } from "./ports/store.ts";
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  UPDATE_READY_TOAST,
  restartListenerAfterUpdate,
  startUpdates,
  updateFeedUrl,
  type Updater,
} from "./ports/updates.ts";

class FakeUpdater implements Updater {
  feed?: string;
  checks = 0;
  throwOnCheck = false;
  #downloaded: Array<() => void> = [];
  #errors: Array<(e: Error) => void> = [];
  setFeedURL(o: { url: string }) {
    this.feed = o.url;
  }
  checkForUpdates() {
    this.checks++;
    if (this.throwOnCheck) throw new Error("no network");
  }
  on(event: "update-downloaded" | "error", listener: never) {
    if (event === "update-downloaded") this.#downloaded.push(listener);
    else this.#errors.push(listener);
  }
  download() {
    for (const l of this.#downloaded) l();
  }
  fail(message: string) {
    for (const l of this.#errors) l(new Error(message));
  }
}

function start() {
  const updater = new FakeUpdater();
  const clock = new FakeClock();
  const toasts: string[] = [];
  const logs: string[] = [];
  const stop = startUpdates({
    updater,
    clock,
    platform: "darwin",
    arch: "arm64",
    version: "0.1.0",
    toast: (t) => toasts.push(t),
    log: (m) => logs.push(m),
  });
  return { updater, clock, toasts, logs, stop };
}

describe("updates", () => {
  test("asks update.electronjs.org about this repo, platform, arch and version", () => {
    expect(updateFeedUrl({ platform: "darwin", arch: "arm64", version: "0.1.0" })).toBe(
      "https://update.electronjs.org/abdullahnettoor/couch/darwin-arm64/0.1.0",
    );
    expect(start().updater.feed).toBe(
      "https://update.electronjs.org/abdullahnettoor/couch/darwin-arm64/0.1.0",
    );
  });

  test("checks a minute after start, then every six hours, until stopped", () => {
    const { updater, clock, stop } = start();
    clock.advance(FIRST_CHECK_MS - 1);
    expect(updater.checks).toBe(0);
    clock.advance(1);
    expect(updater.checks).toBe(1);
    clock.advance(CHECK_EVERY_MS * 2);
    expect(updater.checks).toBe(3);
    stop();
    clock.advance(CHECK_EVERY_MS * 2);
    expect(updater.checks).toBe(3);
  });

  test("a downloaded update is a toast, said once, never a restart", () => {
    const { updater, toasts } = start();
    updater.download();
    updater.download();
    expect(toasts).toEqual([UPDATE_READY_TOAST]);
  });

  test("a failed check is only logged", () => {
    const { updater, clock, toasts, logs } = start();
    updater.throwOnCheck = true;
    clock.advance(FIRST_CHECK_MS);
    updater.fail("offline");
    expect(toasts).toEqual([]);
    expect(logs).toEqual(["Update check failed: no network", "Update check failed: offline"]);
  });
  test("a downloaded update ends the checks until Couch restarts", () => {
    const { updater, clock } = start();
    clock.advance(FIRST_CHECK_MS);
    updater.download();
    clock.advance(CHECK_EVERY_MS * 3);
    expect(updater.checks).toBe(1);
  });
});

describe("the beta channel", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  function startBeta(version: string, feed: () => unknown) {
    const updater = new FakeUpdater();
    const clock = new FakeClock();
    const logs: string[] = [];
    const fetched: string[] = [];
    startUpdates({
      updater,
      clock,
      platform: "darwin",
      arch: "arm64",
      version,
      channel: "beta",
      toast: () => {},
      fetchJson: async (url) => {
        fetched.push(url);
        return feed();
      },
      log: (m) => logs.push(m),
    });
    return { updater, clock, logs, fetched };
  }

  test("reads the beta feed file on GitHub, and gives Squirrel that file", async () => {
    const { updater, clock, fetched } = startBeta("0.1.1", () => ({ version: "0.2.0-beta.1" }));
    const url =
      "https://github.com/abdullahnettoor/couch/releases/download/beta-feed/beta-darwin-arm64.json";
    expect(updater.feed).toBe(url);
    clock.advance(FIRST_CHECK_MS);
    await flush();
    expect(fetched).toEqual([url]);
    expect(updater.checks).toBe(1);
  });

  test("asks Squirrel only for a newer version, never the same or an older one", async () => {
    let version = "0.2.0-beta.1";
    const { updater, clock } = startBeta("0.2.0-beta.1", () => ({ version }));
    clock.advance(FIRST_CHECK_MS);
    await flush();
    expect(updater.checks).toBe(0);
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

  test("a feed that can't be read or names no version is only logged", async () => {
    let feed: () => unknown = () => {
      throw new Error("HTTP 404");
    };
    const { updater, clock, logs } = startBeta("0.1.1", () => feed());
    clock.advance(FIRST_CHECK_MS);
    await flush();
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
