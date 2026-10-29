import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { MemoryStore } from "../ports/store.ts";
import { startFairPlay } from "./fairplay.ts";
import { SwitchableWebApp, type SwitchableHost } from "./switchable-web-app.ts";
import {
  NATIVE_APP_CLASS,
  nativeAppFront,
  chooseEngine,
  engineAfterProbe,
  type Engine,
} from "./native-front.ts";

describe("the renderer is transparent while a native App view is in front", () => {
  const native = new Set(["netflix"]);

  test("only for an App that is a native view, and only while it is the front view", () => {
    expect(nativeAppFront({ view: "app", app: "netflix" }, native)).toBe(true);
    expect(nativeAppFront({ view: "app", app: "youtube" }, native)).toBe(false);
    expect(nativeAppFront({ view: "home" }, native)).toBe(false);
    expect(nativeAppFront({ view: "player" }, native)).toBe(false);
    expect(nativeAppFront({ view: "app" }, native)).toBe(false);
  });

  test("the App error screen is Couch's own opaque screen: not transparent, so a failed view never shows through", () => {
    expect(nativeAppFront({ view: "appError", app: "netflix" }, native)).toBe(false);
  });

  test("the renderer's stylesheet makes the page transparent for that class", () => {
    const css = readFileSync(
      join(import.meta.dirname, "../../renderer/player-overlay.css"),
      "utf8",
    );
    expect(css).toMatch(
      new RegExp(`body\\.${NATIVE_APP_CLASS}[^{]*\\{[^}]*background:\\s*transparent`),
    );
  });
});

describe("choosing the Netflix engine", () => {
  const yes = { available: true } as const;
  const no = { available: false, reason: "FairPlay isn't available on this Mac" } as const;

  test("WebKit is the default where FairPlay is available", () => {
    expect(chooseEngine({ packaged: false, stored: undefined, env: {}, webkit: yes })).toEqual({
      engine: "webkit",
    });
  });

  test("Chromium is the fallback, with the reason, where it isn't", () => {
    expect(chooseEngine({ packaged: false, stored: undefined, env: {}, webkit: no })).toEqual({
      engine: "chromium",
      reason: no.reason,
    });
  });

  test("a stored WebKit choice is only as good as FairPlay: it falls back with the reason and comes back with it", () => {
    expect(chooseEngine({ packaged: false, stored: "webkit", env: {}, webkit: no })).toEqual({
      engine: "chromium",
      reason: no.reason,
    });
    expect(chooseEngine({ packaged: false, stored: "webkit", env: {}, webkit: yes })).toEqual({
      engine: "webkit",
    });
  });

  test("a stored Chromium choice is honoured even where WebKit is available, and needs no reason", () => {
    expect(chooseEngine({ packaged: false, stored: "chromium", env: {}, webkit: yes })).toEqual({
      engine: "chromium",
    });
  });

  test("COUCH_NETFLIX_ENGINE is a developer override over the stored choice in an unpackaged run", () => {
    const dev = { packaged: false };
    expect(
      chooseEngine({
        ...dev,
        stored: "chromium",
        env: { COUCH_NETFLIX_ENGINE: "webkit" },
        webkit: yes,
      }),
    ).toEqual({ engine: "webkit" });
    expect(
      chooseEngine({
        ...dev,
        stored: "webkit",
        env: { COUCH_NETFLIX_ENGINE: "chromium" },
        webkit: yes,
      }),
    ).toEqual({ engine: "chromium" });
    expect(
      chooseEngine({
        ...dev,
        stored: undefined,
        env: { COUCH_NETFLIX_ENGINE: "webkit" },
        webkit: no,
      }),
    ).toEqual({ engine: "chromium", reason: no.reason });
  });

  test("the installed app ignores the variable: the household's choice wins", () => {
    const installed = { packaged: true };
    expect(
      chooseEngine({
        ...installed,
        stored: "chromium",
        env: { COUCH_NETFLIX_ENGINE: "webkit" },
        webkit: yes,
      }),
    ).toEqual({ engine: "chromium" });
    expect(
      chooseEngine({
        ...installed,
        stored: "webkit",
        env: { COUCH_NETFLIX_ENGINE: "chromium" },
        webkit: yes,
      }),
    ).toEqual({ engine: "webkit" });
    expect(
      chooseEngine({
        ...installed,
        stored: undefined,
        env: { COUCH_NETFLIX_ENGINE: "chromium" },
        webkit: yes,
      }),
    ).toEqual({ engine: "webkit" });
  });

  test("any other value of the variable is ignored", () => {
    expect(
      chooseEngine({
        packaged: false,
        stored: "chromium",
        env: { COUCH_NETFLIX_ENGINE: "other" },
        webkit: yes,
      }),
    ).toEqual({ engine: "chromium" });
  });
});

describe("starting Couch without waiting for the FairPlay probe", () => {
  function host(engine: Engine): SwitchableHost {
    const keys: string[] = [];
    return {
      engine,
      keys,
      sendKey: (k: string) => keys.push(k),
      onEvent: () => () => {},
      dispose: () => {},
      setKeyGate: () => {},
      show: () => {},
      hide: () => {},
    } as unknown as SwitchableHost;
  }

  function rig(o: { run: () => Promise<unknown>; stored?: Engine; packaged?: boolean }) {
    const store = new MemoryStore();
    const hosts: Array<SwitchableHost & { engine: Engine; keys: string[] }> = [];
    const first = chooseEngine({
      packaged: false,
      stored: o.stored,
      env: {},
      webkit: { available: false, reason: "Still checking" },
    });
    const switcher = new SwitchableWebApp((e) => {
      const h = host(e) as SwitchableHost & { engine: Engine; keys: string[] };
      hosts.push(h);
      return h;
    }, first.engine);
    const fp = startFairPlay(
      { store, version: "v", run: o.run, timeoutMs: 5000 },
      engineAfterProbe({
        packaged: o.packaged ?? false,
        stored: () => o.stored,
        env: {},
        switcher,
      }),
    );
    return { switcher, hosts, fp };
  }
  const granted = { keySystems: { "com.apple.fps.3_0": "granted" } };

  test("a probe that never resolves leaves Netflix working on Chromium", () => {
    const { switcher, hosts, fp } = rig({ run: () => new Promise(() => {}) });
    expect(switcher.engine).toBe("chromium");
    switcher.sendKey("ok");
    expect(hosts[0]!.keys).toEqual(["ok"]);
    expect(fp.current().available).toBe(false);
  });

  test("a late 'available' switches quietly while Netflix is hidden", async () => {
    let release: (v: unknown) => void = () => {};
    const { switcher } = rig({ run: () => new Promise((r) => (release = r)) });
    release(granted);
    await vi.waitFor(() => expect(switcher.engine).toBe("webkit"));
  });

  test("with Netflix in front it waits, and switches when it is hidden; playback is never interrupted", async () => {
    let release: (v: unknown) => void = () => {};
    const { switcher, hosts, fp } = rig({ run: () => new Promise((r) => (release = r)) });
    switcher.show();
    release(granted);
    await fp.done;
    expect(switcher.engine).toBe("chromium");
    expect(hosts).toHaveLength(1);
    switcher.hide();
    expect(switcher.engine).toBe("webkit");
  });

  test("a stored Chromium choice is not overridden by a late answer", async () => {
    const { switcher, fp } = rig({ run: async () => granted, stored: "chromium" });
    await fp.done;
    expect(switcher.engine).toBe("chromium");
  });

  test("a denial or a failed check changes nothing", async () => {
    const denied = rig({ run: async () => ({ keySystems: { "com.apple.fps.3_0": "denied: X" } }) });
    await denied.fp.done;
    expect(denied.switcher.engine).toBe("chromium");
    const failed = rig({ run: () => Promise.reject(new Error("x")) });
    await failed.fp.done;
    expect(failed.switcher.engine).toBe("chromium");
  });

  test("a failed quiet switch leaves Chromium running", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const switcher = new SwitchableWebApp((e) => {
      if (++n === 2) throw new Error("no view");
      return host(e);
    }, "chromium");
    const answer = engineAfterProbe({
      packaged: false,
      stored: () => undefined,
      env: {},
      switcher,
    });
    answer({ available: true });
    expect(switcher.engine).toBe("chromium");
    warn.mockRestore();
  });
});
