import { describe, expect, test } from "vite-plus/test";
import type { YouTubeEvent } from "../ports/youtube.ts";
import { SwitchableWebApp, type SwitchableHost } from "./switchable-web-app.ts";
import type { Engine } from "./native-front.ts";
import { FakeClock } from "../ports/fakes.ts";
import { MemoryStore } from "../ports/store.ts";
import { IdleUnloader, type IdleLifecycle } from "./idle-unload.ts";

class FakeHost implements SwitchableHost {
  calls: string[] = [];
  listeners = new Set<(e: YouTubeEvent) => void>();
  disposed = false;
  unloaded = false;
  followsMacOutput: boolean;
  readonly engine: Engine;
  /** Set to make the next setup call (key gate) throw: an init failure. */
  failInit = false;
  idle: IdleLifecycle | undefined;
  constructor(engine: Engine, idle?: IdleLifecycle) {
    this.engine = engine;
    this.idle = idle;
    this.followsMacOutput = engine === "webkit";
  }
  #log(c: string) {
    this.calls.push(c);
  }
  show() {
    this.#log("show");
    this.idle?.shown();
  }
  hide() {
    this.#log("hide");
    this.idle?.hidden();
  }
  start() {
    this.#log("start");
  }
  focus() {
    this.#log("focus");
  }
  sendKey(k: string) {
    this.#log(`key:${k}`);
  }
  submitSearch() {}
  showSearchBar() {}
  captureText(on: boolean) {
    this.#log(`capture:${on}`);
  }
  playPause() {}
  seekBy() {}
  showVolume() {}
  showConfirm() {}
  setVolume(p: number) {
    this.#log(`volume:${p}`);
  }
  async setOutputDevice(n: string | undefined) {
    this.#log(`output:${n}`);
    return true;
  }
  restart() {
    this.#log("restart");
  }
  unload() {
    this.#log("unload");
    this.unloaded = true;
  }
  setAddons() {}
  setKeyGate() {
    if (this.failInit) throw new Error("init failed");
    this.#log("gate");
  }
  setOverlay(on: boolean) {
    this.#log(`overlay:${on}`);
  }
  onEvent(l: (e: YouTubeEvent) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  dispose() {
    this.disposed = true;
    this.#log("dispose");
    for (const l of Array.from(this.listeners)) l({ type: "route", home: true });
  }
  emit(e: YouTubeEvent) {
    for (const l of Array.from(this.listeners)) l(e);
  }
}

function rig(initial: Engine = "chromium") {
  const hosts: FakeHost[] = [];
  const app = new SwitchableWebApp((engine) => {
    const h = new FakeHost(engine);
    hosts.push(h);
    return h;
  }, initial);
  const events: YouTubeEvent[] = [];
  app.onEvent((e) => events.push(e));
  return { app, hosts, events };
}

describe("the Netflix host that can switch engine", () => {
  test("starts on the engine it is given and passes calls to it", () => {
    const { app, hosts } = rig("webkit");
    app.sendKey("ok");
    expect(app.engine).toBe("webkit");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.calls).toContain("key:ok");
  });

  test("switching disposes the old host and shows nothing of it again", () => {
    const { app, hosts } = rig("chromium");
    app.switchTo("webkit");
    expect(hosts.map((h) => h.engine)).toEqual(["chromium", "webkit"]);
    expect(hosts[0]!.disposed).toBe(true);
    expect(hosts[0]!.listeners.size).toBe(0);
    app.sendKey("up");
    expect(hosts[0]!.calls).not.toContain("key:up");
    expect(hosts[1]!.calls).toContain("key:up");
  });

  test("the core hears the old host go back to home (its route resets) and then only the new host", () => {
    const { app, hosts, events } = rig("chromium");
    app.switchTo("webkit");
    expect(events).toEqual([{ type: "route", home: true }]);
    hosts[0]!.emit({ type: "loaded" });
    expect(events).toHaveLength(1);
    hosts[1]!.emit({ type: "loaded" });
    expect(events.at(-1)).toEqual({ type: "loaded" });
  });

  test("switching to the engine already running does nothing", () => {
    const { app, hosts } = rig("webkit");
    app.switchTo("webkit");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.disposed).toBe(false);
  });

  test("the new host gets Couch's state: key gate, volume, output, text capture, overlay", async () => {
    const { app, hosts } = rig("chromium");
    app.setKeyGate(() => false);
    app.setVolume(40);
    await app.setOutputDevice("TV");
    app.captureText(true);
    app.setOverlay(true);
    app.switchTo("webkit");
    const calls = hosts[1]!.calls;
    for (const c of ["gate", "volume:40", "output:TV", "capture:true", "overlay:true"])
      expect(calls).toContain(c);
  });

  test("a hidden host is never started by a switch (it loads on its next show); one on screen comes back on screen", () => {
    const idle = rig("chromium");
    idle.app.switchTo("webkit");
    expect(idle.hosts[1]!.calls).not.toContain("start");
    expect(idle.hosts[1]!.calls).not.toContain("show");

    const used = rig("chromium");
    used.app.show();
    used.app.hide();
    used.app.switchTo("webkit");
    expect(used.hosts[1]!.calls).not.toContain("start");
    expect(used.hosts[1]!.calls).not.toContain("show");
    used.app.show();
    expect(used.hosts[1]!.calls).toContain("show");

    const front = rig("chromium");
    front.app.show();
    front.app.switchTo("webkit");
    expect(front.hosts[1]!.calls).toContain("show");
  });

  test("followsMacOutput follows the engine", () => {
    const { app } = rig("chromium");
    expect(app.followsMacOutput).toBeFalsy();
    app.switchTo("webkit");
    expect(app.followsMacOutput).toBe(true);
    app.switchTo("chromium");
    expect(app.followsMacOutput).toBeFalsy();
  });

  test("many switches leave one live host and no listeners behind", () => {
    const { app, hosts } = rig("chromium");
    for (let i = 0; i < 6; i++) app.switchTo(i % 2 === 0 ? "webkit" : "chromium");
    expect(hosts.filter((h) => !h.disposed)).toHaveLength(1);
    expect(hosts.filter((h) => !h.disposed)[0]!.listeners.size).toBe(1);
    expect(hosts.filter((h) => h.disposed).every((h) => h.listeners.size === 0)).toBe(true);
  });

  test("webkit() is the WebKit host only while it is the engine", () => {
    const { app, hosts } = rig("chromium");
    expect(app.host("webkit")).toBeUndefined();
    app.switchTo("webkit");
    expect(app.host("webkit")).toBe(hosts[1]);
  });
});

describe("switching is transactional", () => {
  function failing(initial: Engine, plan: (engine: Engine, n: number) => "ok" | "create" | "init") {
    const hosts: FakeHost[] = [];
    let n = 0;
    const app = new SwitchableWebApp((engine) => {
      const how = plan(engine, ++n);
      if (how === "create") throw new Error("factory failed");
      const h = new FakeHost(engine);
      h.failInit = how === "init";
      hosts.push(h);
      return h;
    }, initial);
    const events: YouTubeEvent[] = [];
    app.onEvent((e) => events.push(e));
    return { app, hosts, events };
  }

  test("a factory failure keeps the old host, untouched and still wired", () => {
    const { app, hosts, events } = failing("chromium", (_e, n) => (n === 2 ? "create" : "ok"));
    app.setKeyGate(() => false);
    expect(() => app.switchTo("webkit")).toThrow(/factory failed/);
    expect(app.engine).toBe("chromium");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.disposed).toBe(false);
    expect(events).toEqual([]);
    app.sendKey("ok");
    expect(hosts[0]!.calls).toContain("key:ok");
    hosts[0]!.emit({ type: "loaded" });
    expect(events).toEqual([{ type: "loaded" }]);
  });

  test("an init failure disposes the half-built host and keeps the old one", () => {
    const { app, hosts, events } = failing("chromium", (_e, n) => (n === 2 ? "init" : "ok"));
    app.setKeyGate(() => false);
    expect(() => app.switchTo("webkit")).toThrow(/init failed/);
    expect(app.engine).toBe("chromium");
    expect(hosts.map((h) => h.disposed)).toEqual([false, true]);
    expect(hosts[1]!.listeners.size).toBe(0);
    expect(events).toEqual([]);
    app.sendKey("ok");
    expect(hosts[0]!.calls).toContain("key:ok");
  });

  test("switching still works after a failure, in both directions", () => {
    const { app, hosts } = failing("chromium", (_e, n) => (n === 2 ? "init" : "ok"));
    app.setKeyGate(() => false);
    expect(() => app.switchTo("webkit")).toThrow();
    app.switchTo("webkit");
    expect(app.engine).toBe("webkit");
    expect(hosts[0]!.disposed).toBe(true);
    app.switchTo("chromium");
    expect(app.engine).toBe("chromium");
    expect(hosts.filter((h) => !h.disposed)).toHaveLength(1);
  });

  test("the new host is built and set up before the old one is disposed", () => {
    const order: string[] = [];
    const hosts: FakeHost[] = [];
    const app = new SwitchableWebApp((engine) => {
      order.push(`create:${engine}`);
      const h = new FakeHost(engine);
      const dispose = h.dispose.bind(h);
      h.dispose = () => (order.push(`dispose:${engine}`), dispose());
      const gate = h.setKeyGate.bind(h);
      h.setKeyGate = () => (order.push(`gate:${engine}`), gate());
      hosts.push(h);
      return h;
    }, "chromium");
    app.setKeyGate(() => false);
    order.length = 0;
    app.switchTo("webkit");
    expect(order).toEqual(["create:webkit", "gate:webkit", "dispose:chromium"]);
  });
});

describe("switching after an idle unload (the real IdleUnloader)", () => {
  test("a switch after the App was idle-unloaded does not start the new host; it loads on its next show", () => {
    const clock = new FakeClock();
    const unloader = new IdleUnloader(clock, new MemoryStore());
    const youtube = unloader.track("youtube", () => {}, { loaded: true });
    const idle = unloader.track("netflix", () => app.unload());
    const hosts: FakeHost[] = [];
    const app: SwitchableWebApp = new SwitchableWebApp((engine) => {
      const h = new FakeHost(engine, idle);
      hosts.push(h);
      return h;
    }, "chromium");
    app.show();
    app.hide();
    youtube.shown();
    youtube.hidden();
    clock.advance(10 * 60_000);
    expect(hosts[0]!.unloaded).toBe(true);
    app.switchTo("webkit");
    expect(hosts[1]!.calls).not.toContain("start");
    expect(hosts[1]!.calls).not.toContain("show");
    app.show();
    expect(hosts[1]!.calls).toContain("show");
  });
});

describe("switching when the App is in front is put off", () => {
  test("switchWhenAway switches at once while hidden", () => {
    const { app, hosts } = rig("chromium");
    expect(app.switchWhenAway("webkit")).toBe(true);
    expect(app.engine).toBe("webkit");
    expect(hosts[0]!.disposed).toBe(true);
  });

  test("while in front it waits, never touching the host on screen, and switches when hidden", () => {
    const { app, hosts } = rig("chromium");
    app.show();
    expect(app.switchWhenAway("webkit")).toBe(false);
    expect(app.engine).toBe("chromium");
    expect(hosts).toHaveLength(1);
    app.hide();
    expect(app.engine).toBe("webkit");
    expect(hosts[0]!.disposed).toBe(true);
    expect(hosts[1]!.calls).not.toContain("start");
  });

  test("an explicit switch cancels the wait", () => {
    const { app } = rig("chromium");
    app.show();
    app.switchWhenAway("webkit");
    app.switchTo("webkit");
    app.switchTo("chromium");
    app.hide();
    expect(app.engine).toBe("chromium");
  });

  test("the switch listener hears each real switch, and a failed deferred switch is not fatal", () => {
    let n = 0;
    const app = new SwitchableWebApp((engine) => {
      if (++n === 2) throw new Error("nope");
      return new FakeHost(engine);
    }, "chromium");
    const heard: Engine[] = [];
    app.onSwitch((e) => heard.push(e));
    app.show();
    app.switchWhenAway("webkit");
    expect(() => app.hide()).not.toThrow();
    expect(app.engine).toBe("chromium");
    app.switchTo("webkit");
    expect(heard).toEqual(["webkit"]);
  });
});
