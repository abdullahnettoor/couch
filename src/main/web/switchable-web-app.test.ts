import { describe, expect, test } from "vite-plus/test";
import type { YouTubeEvent } from "../ports/youtube.ts";
import { SwitchableWebApp, type SwitchableHost } from "./switchable-web-app.ts";
import type { Engine } from "./native-front.ts";

class FakeHost implements SwitchableHost {
  calls: string[] = [];
  listeners = new Set<(e: YouTubeEvent) => void>();
  disposed = false;
  followsMacOutput: boolean;
  readonly engine: Engine;
  constructor(engine: Engine) {
    this.engine = engine;
    this.followsMacOutput = engine === "webkit";
  }
  #log(c: string) {
    this.calls.push(c);
  }
  show() {
    this.#log("show");
  }
  hide() {
    this.#log("hide");
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
  }
  setAddons() {}
  setKeyGate() {
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

  test("a host that was never opened is not started; one that was is, and one on screen comes back on screen", () => {
    const idle = rig("chromium");
    idle.app.switchTo("webkit");
    expect(idle.hosts[1]!.calls).not.toContain("start");
    expect(idle.hosts[1]!.calls).not.toContain("show");

    const used = rig("chromium");
    used.app.show();
    used.app.hide();
    used.app.switchTo("webkit");
    expect(used.hosts[1]!.calls).toContain("start");
    expect(used.hosts[1]!.calls).not.toContain("show");

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
