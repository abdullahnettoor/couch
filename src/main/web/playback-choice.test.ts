import { describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "../ports/store.ts";
import type { Engine, WebKitAvailability } from "./native-front.ts";
import { createPlayback, readStoredEngine } from "./playback-choice.ts";

function rig(webkit: WebKitAvailability, engine: Engine) {
  const store = new MemoryStore();
  const switches: Engine[] = [];
  const host = {
    engine,
    switchTo(e: Engine) {
      switches.push(e);
      host.engine = e;
    },
  };
  const playback = createPlayback({ store, appId: "netflix", host, webkit });
  return { store, switches, host, playback };
}
const yes = { available: true } as const;
const no = { available: false, reason: "FairPlay isn't available on this Mac" } as const;

describe("the per-App playback choice", () => {
  test("nothing is stored until the household chooses", () => {
    const { store } = rig(yes, "webkit");
    expect(readStoredEngine(store, "netflix")).toBeUndefined();
  });

  test("offers WebKit (FairPlay) and Chromium (Widevine), and names the one in use", () => {
    const { playback, host } = rig(yes, "webkit");
    expect(playback.options.map((o) => o.label)).toEqual([
      "WebKit (FairPlay)",
      "Chromium (Widevine)",
    ]);
    expect(playback.current().id).toBe("webkit");
    host.engine = "chromium";
    expect(playback.current().id).toBe("chromium");
  });

  test("choosing stores it for this App and swaps the host", async () => {
    const { playback, store, switches } = rig(yes, "webkit");
    await playback.select("chromium");
    expect(readStoredEngine(store, "netflix")).toBe("chromium");
    expect(readStoredEngine(store, "youtube")).toBeUndefined();
    expect(switches).toEqual(["chromium"]);
  });

  test("WebKit can't be chosen where FairPlay isn't available, and nothing changes", async () => {
    const { playback, store, switches } = rig(no, "chromium");
    await expect(playback.select("webkit")).rejects.toThrow(/FairPlay/);
    expect(readStoredEngine(store, "netflix")).toBeUndefined();
    expect(switches).toEqual([]);
  });

  test("the reason is on offer whenever WebKit isn't available, and only then", () => {
    expect(rig(no, "chromium").playback.unavailable).toBe(no.reason);
    expect(rig(yes, "chromium").playback.unavailable).toBeUndefined();
  });

  test("choosing Chromium where WebKit is unavailable is fine (it is already the engine)", async () => {
    const { playback, store } = rig(no, "chromium");
    await playback.select("chromium");
    expect(readStoredEngine(store, "netflix")).toBe("chromium");
  });

  test("an unknown engine is refused", async () => {
    const { playback } = rig(yes, "webkit");
    await expect(playback.select("gecko")).rejects.toThrow();
  });

  test("a damaged document is no choice", () => {
    const store = new MemoryStore();
    store.write("apps-playback", { netflix: 7 });
    expect(readStoredEngine(store, "netflix")).toBeUndefined();
    store.write("apps-playback", "x");
    expect(readStoredEngine(store, "netflix")).toBeUndefined();
  });
});
