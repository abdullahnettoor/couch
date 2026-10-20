import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { startHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.stop();
});

const focused = (hh: Harness) => hh.screen.last.focusedLabel;

describe("Remote on Home", () => {
  test("a phone connects and gets a snapshot of Home", async () => {
    const phone = await h.connectPhone();
    expect(phone.last).toMatchObject({
      type: "snapshot",
      where: "Home",
      remotes: 1,
      typeAvailable: false,
    });
  });

  test("the Remote page is served", async () => {
    const res = await fetch(`http://127.0.0.1:${h.app.remote.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Couch Remote");
  });

  test("every connected phone gets a snapshot after each change", async () => {
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    await a.settle();
    expect(a.last?.remotes).toBe(2);
    const before = b.snapshots.length;
    await a.press("right");
    await b.waitFor(() => b.snapshots.length > before);
    expect(b.last?.remotes).toBe(2);
  });

  test("arrows move focus between the Apps and up reaches the settings gear", async () => {
    const phone = await h.connectPhone();
    expect(focused(h)).toBe("YouTube");
    await phone.press("right");
    expect(focused(h)).toBe("Library");
    await phone.press("right");
    expect(focused(h)).toBe("Library");
    await phone.press("up");
    expect(focused(h)).toBe("Settings");
    await phone.press("down");
    expect(focused(h)).toBe("YouTube");
    await phone.press("left");
    expect(focused(h)).toBe("YouTube");
  });

  test("a toast shows on the Screen and clears itself", async () => {
    await h.connectPhone();
    expect(h.screen.last.state.toast).toBe("Phone connected");
    h.clock.advance(3500);
    expect(h.screen.last.state.toast).toBeUndefined();
  });

  test("Home goes to Home", async () => {
    const phone = await h.connectPhone();
    const snap = await phone.press("home");
    expect(snap.where).toBe("Home");
    expect(h.screen.last.state.view).toBe("home");
  });

  test("the Screen's keyboard and a phone produce identical results", async () => {
    const phone = await h.connectPhone();
    h.clock.advance(3500);
    const sequence = ["right", "up", "down", "left", "ok", "home"] as const;
    const viaPhone: unknown[] = [];
    for (const command of sequence) {
      await phone.press(command);
      viaPhone.push({
        focus: focused(h),
        toast: h.screen.last.state.toast,
        view: h.screen.last.state.view,
      });
    }
    const keyboard = await startHarness();
    const viaKeys: unknown[] = [];
    for (const command of sequence) {
      keyboard.app.screenCommand({ command });
      viaKeys.push({
        focus: keyboard.screen.last.focusedLabel,
        toast: keyboard.screen.last.state.toast,
        view: keyboard.screen.last.state.view,
      });
    }
    await keyboard.stop();
    expect(viaKeys).toEqual(viaPhone);
  });

  test("the Home clock updates every minute, driven by the Clock port", async () => {
    const first = h.screen.payloads.length;
    const start = h.screen.last?.now ?? h.clock.now();
    h.clock.advance(60_000);
    expect(h.screen.payloads.length).toBeGreaterThan(first);
    expect(h.screen.last.now).toBe(start + 60_000);
    const count = h.screen.payloads.length;
    h.clock.advance(30_000);
    expect(h.screen.payloads.length).toBe(count);
  });

  test("garbage and unknown commands are ignored", async () => {
    const phone = await h.connectPhone();
    const before = phone.snapshots.length;
    // @ts-expect-error not a command
    phone.send({ command: "rm -rf" });
    await new Promise((r) => setTimeout(r, 100));
    expect(phone.snapshots.length).toBe(before);
  });

  test("a phone leaving drops the connected count", async () => {
    const a = await h.connectPhone();
    const b = await h.connectPhone();
    await a.settle();
    b.close();
    await a.waitFor(() => a.last?.remotes === 1);
    expect(h.screen.last.state.remotes).toBe(1);
  });
});
