import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { detectListener } from "./frontdoor.ts";
import { MemoryStore } from "./ports/store.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

const canBind = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });

describe("detecting a listener that is still starting", () => {
  const status = { pid: 1, publicPort: 4747, appPort: 4748, token: "t" };
  const setup = (installed: boolean, appearsAfter: number | undefined) => {
    const store = new MemoryStore();
    let polls = 0;
    const sleeps: number[] = [];
    const run = () =>
      detectListener({
        store,
        installed: async () => installed,
        probe: { pidExists: () => true, portAnswers: async () => true },
        sleep: async (ms) => {
          sleeps.push(ms);
          if (++polls === appearsAfter) store.write("listener", status);
        },
        windowMs: 2000,
        pollMs: 250,
      });
    return { run, sleeps };
  };

  test("an installed listener that shows up shortly after is found, so Couch stays off the public port", async () => {
    const { run } = setup(true, 3);
    expect(await run()).toEqual(status);
  });

  test("an installed listener that never shows up is given a bounded wait, then there is none", async () => {
    const { run, sleeps } = setup(true, undefined);
    expect(await run()).toBeUndefined();
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2000);
  });

  test("with no listener installed there is no waiting", async () => {
    const { run, sleeps } = setup(false, 3);
    expect(await run()).toBeUndefined();
    expect(sleeps).toEqual([]);
  });
});

describe("toggling the listener while Couch runs", () => {
  let h: Harness;
  let held: Server | undefined;
  afterEach(async () => {
    held?.close();
    held = undefined;
    await h?.stop();
  });

  async function toggleInSettings(phone: Awaited<ReturnType<Harness["connectPhone"]>>) {
    await phone.press("home");
    await phone.press("down");
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("up");
    await phone.press("ok");
    await phone.press("ok");
    while (h.screen.last.focusedId !== "listener") await phone.press("down");
    await phone.settle();
    await phone.press("ok");
  }
  const until = async (fn: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await fn()).toBe(true);
  };

  test("turning it on frees the public port for the listener, then Couch moves to loopback behind it", async () => {
    const [publicPort, appPort] = [await freePort(), await freePort()];
    h = await startHarness(undefined, {
      frontdoor: { env: { COUCH_PORT: String(publicPort) }, sleep: async () => {}, pollMs: 1 },
    });
    const phone = await h.connectPhone();
    let publicFreeWhenBootstrapped: boolean | undefined;
    h.mac.onLoginItemSet = async (on) => {
      if (!on) return;
      publicFreeWhenBootstrapped = await canBind(publicPort);
      h.listenerUp.alive = true;
      h.store.write("listener", { pid: 4242, publicPort, appPort, token: "tok" });
    };
    await toggleInSettings(phone);
    await until(() => h.app.remote?.port === appPort);
    expect(publicFreeWhenBootstrapped).toBe(true);
    expect(h.app.core.pairingUrl).toContain(`:${publicPort}/?key=`);
    expect(h.screen.last.listener).toEqual({ available: true, on: true, running: true });
  });

  test("turning it off puts Couch back on the public port, waiting out the listener's last moments", async () => {
    const [publicPort, appPort] = [await freePort(), await freePort()];
    let sleeps = 0;
    h = await startHarness(undefined, {
      listener: { publicPort, token: "tok" },
      frontdoor: {
        env: { COUCH_PORT: String(publicPort) },
        pollMs: 1,
        sleep: async () => {
          if (++sleeps === 3) await new Promise<void>((r) => held?.close(() => r()));
        },
      },
    });
    h.store.write("listener", { pid: 4242, publicPort, appPort, token: "tok" });
    h.mac.loginItem.on = true;
    await h.app.core.refreshLoginItem();
    const phone = await h.connectPhone();
    h.mac.onLoginItemSet = async (on) => {
      if (on) return;
      h.listenerUp.alive = false;
      held = createServer().listen(publicPort);
      await new Promise((r) => held!.once("listening", r));
    };
    await toggleInSettings(phone);
    await until(() => h.app.remote?.port === publicPort);
    expect(sleeps).toBeGreaterThanOrEqual(3);
    expect(h.app.core.pairingUrl).toContain(`:${publicPort}/?key=`);
    expect(h.screen.last.listener).toEqual({ available: true, on: false, running: false });
  });
});

describe("Settings reads the listener live", () => {
  let h: Harness;
  afterEach(() => h?.stop());

  test("running follows the listener while Settings is open and when it is opened again", async () => {
    h = await startHarness(undefined, { listener: { publicPort: 4790, token: "t" } });
    const phone = await h.connectPhone();
    await openSettings(phone);
    expect(h.screen.last.state.view).toBe("settingsRemotes");
    expect(h.screen.last.listener?.running).toBe(true);

    h.listenerUp.alive = false;
    await openSettings(phone);
    await until(() => h.screen.last.listener?.running === false);
    expect(h.screen.last.listener?.running).toBe(false);

    h.listenerUp.alive = true;
    await openSettings(phone);
    await until(() => h.screen.last.listener?.running === true);
  });

  async function openSettings(phone: Awaited<ReturnType<Harness["connectPhone"]>>) {
    await phone.press("home");
    await phone.press("down");
    await phone.press("right");
    await phone.press("right");
    await phone.press("ok");
    await phone.press("up");
    await phone.press("ok");
    await phone.press("ok");
    await phone.settle();
  }

  async function until(fn: () => boolean) {
    for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
  }
});
