import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { BitChordApp } from "./apps/bitchord/bitchord-app.ts";
import { FakeClock, FakeWebApp, FakeYouTube } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
let tube: FakeWebApp;
let phone: FakePhone;

const entry = (id: string, label: string) => ({
  id,
  label,
  icon: "<svg></svg>",
  action: `app:open:${id}`,
  web: true,
});

beforeEach(async () => {
  tube = new FakeWebApp("tube", "Tube", {});
  h = await startHarness(undefined, { apps: [{ entry: entry("tube", "Tube"), app: tube }] });
  phone = await h.connectPhone();
});
afterEach(() => h.stop());

const send = async (p: FakePhone, command: Parameters<FakePhone["send"]>[0]) => {
  p.send(command);
  await p.settle(15);
};
const move = (dx: number, dy: number, p = phone) =>
  send(p, { command: "pointerMove", args: { dx, dy } });
const scroll = (dx: number, dy: number, p = phone) =>
  send(p, { command: "pointerScroll", args: { dx, dy } });
const draws = () => h.screen.pointer.draws;
const lastDraw = () => draws().at(-1)!;

describe("Pointer mode: the mode", () => {
  test("it starts off, and one phone turning it on shows it on every phone", async () => {
    const second = await h.connectPhone();
    expect(phone.last?.pointer).toBeUndefined();
    await send(phone, { command: "pointerMode", args: { on: true } });
    expect(phone.last?.pointer).toBe(true);
    expect(second.last?.pointer).toBe(true);
    await send(second, { command: "pointerMode", args: { on: false } });
    expect(phone.last?.pointer).toBeUndefined();
  });

  test("Couch's own pages share one mode, and each App keeps its own, starting with the D-pad", async () => {
    await send(phone, { command: "pointerMode", args: { on: true } });
    await phone.press({ command: "openSettings" });
    expect(h.screen.last.state.view).toBe("settings");
    expect(phone.last?.pointer).toBe(true);

    await phone.press("home");
    await phone.press({ command: "openApp", args: { app: "tube" } });
    expect(h.screen.last.state.view).toBe("app");
    expect(phone.last?.pointer).toBeUndefined();
    await send(phone, { command: "pointerMode", args: { on: true } });
    expect(phone.last?.pointer).toBe(true);

    await phone.press("home");
    await send(phone, { command: "pointerMode", args: { on: false } });
    expect(phone.last?.pointer).toBeUndefined();
    await phone.press({ command: "openApp", args: { app: "tube" } });
    expect(phone.last?.pointer).toBe(true);
  });

  test("moving between Home, the Library and Settings (Couch's pages) never flips the mode", async () => {
    await send(phone, { command: "pointerMode", args: { on: true } });
    await phone.press({ command: "openSettings" });
    expect(h.screen.last.state.view).toBe("settings");
    expect(phone.last?.pointer).toBe(true);
    await phone.press("back");
    expect(phone.last?.pointer).toBe(true);
    await phone.press("home");
    expect(phone.last?.pointer).toBe(true);
  });

  test("an App's mode is applied again when it reopens, while another App stays on the D-pad", async () => {
    const other = new FakeWebApp("other", "Other", {});
    const two = await startHarness(undefined, {
      apps: [
        { entry: entry("tube", "Tube"), app: tube },
        { entry: entry("other", "Other"), app: other },
      ],
    });
    const p = await two.connectPhone();
    await p.press({ command: "openApp", args: { app: "tube" } });
    await send(p, { command: "pointerMode", args: { on: true } });
    await p.press("home");
    await p.press({ command: "openApp", args: { app: "other" } });
    expect(p.last?.pointer).toBeUndefined();
    await p.press("home");
    await p.press({ command: "openApp", args: { app: "tube" } });
    expect(p.last?.pointer).toBe(true);
    expect(tube.pointerCalls.at(-1)).toEqual({ call: "setMode", args: [true] });
    await two.stop();
  });

  test("while an App plays, Now Playing shows with pointer mode on, on every phone", async () => {
    const second = await h.connectPhone();
    await phone.press({ command: "openApp", args: { app: "tube" } });
    await send(phone, { command: "pointerMode", args: { on: true } });
    tube.emit({
      type: "playback",
      playback: { position: 30, duration: 600, paused: false, title: "Cat" },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    for (const p of [phone, second]) {
      await p.waitFor(() => p.last?.nowPlaying !== undefined && p.last?.pointer === true);
      expect(p.last?.pointerAvailable).toBe(true);
    }
  });

  test("the choice survives a restart", async () => {
    await send(phone, { command: "pointerMode", args: { on: true } });
    const store = h.store;
    for (const p of h.phones) p.close();
    await h.app.stop();
    const again = await startHarness(store);
    const p = await again.connectPhone();
    expect(p.last?.pointer).toBe(true);
    await again.stop();
    h = await startHarness();
    phone = await h.connectPhone();
  });

  test("a pointer command from a phone needs a mode that is on, else it does nothing", async () => {
    await move(40, 40);
    expect(draws().filter((d) => d.shown)).toEqual([]);
    expect(h.screen.pointer.inputs).toEqual([]);
  });
});

describe("Pointer mode: the pointer", () => {
  beforeEach(() => send(phone, { command: "pointerMode", args: { on: true } }));

  test("the first touch shows it, in the middle of the Screen", async () => {
    await move(0, 0);
    expect(lastDraw()).toMatchObject({ shown: true, x: 960, y: 540, style: "arrow" });
  });

  test("dragging right and down moves it right and down", async () => {
    await move(10, 6);
    expect(lastDraw().x).toBeGreaterThan(960);
    expect(lastDraw().y).toBeGreaterThan(540);
  });

  test("a quick flick travels farther per pixel than a slow drag", async () => {
    await move(2, 0);
    const slow = lastDraw().x - 960;
    await move(-2, 0);
    const before = lastDraw().x;
    await move(40, 0);
    const fast = lastDraw().x - before;
    expect(fast / 40).toBeGreaterThan((slow / 2) * 2);
  });

  test("the speed setting sets how far the same drag goes", async () => {
    const travel = async (speed: string) => {
      h.store.write("pointer.speed", speed);
      await move(-1000, 0);
      await move(0, 0);
      const from = lastDraw().x;
      await move(10, 0);
      return lastDraw().x - from;
    };
    const slow = await travel("slow");
    const normal = await travel("normal");
    const fast = await travel("fast");
    expect(slow).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(normal);
  });

  test("a huge delta is clamped, and the pointer stays inside the Screen", async () => {
    await move(1e9, 1e9);
    expect(lastDraw().x).toBeLessThan(960 + 1000);
    for (let i = 0; i < 40; i++) await move(1e9, 1e9);
    expect(lastDraw().x).toBeLessThanOrEqual(1920);
    expect(lastDraw().y).toBeLessThanOrEqual(1080);
    for (let i = 0; i < 80; i++) await move(-1e9, -1e9);
    expect(lastDraw().x).toBeGreaterThanOrEqual(0);
    expect(lastDraw().y).toBeGreaterThanOrEqual(0);
  });

  test("the Screen's size is where the edges are", async () => {
    h.app.setScreenSize({ width: 800, height: 600 });
    for (let i = 0; i < 20; i++) await move(1e9, 1e9);
    expect(lastDraw()).toMatchObject({ x: 800, y: 600 });
  });

  test("reaching the edge buzzes the phone that did it, once, and no other", async () => {
    const second = await h.connectPhone();
    const cues = () => phone.snapshots.map((s) => s.edgeCue).filter((c) => c !== undefined);
    expect(cues()).toEqual([]);
    for (let i = 0; i < 20; i++) await move(100, 0);
    const arrived = phone.last?.edgeCue;
    expect(arrived).toBeGreaterThan(0);
    expect(second.last?.edgeCue).toBeUndefined();
    await move(100, 0);
    await move(100, 0);
    expect(phone.last?.edgeCue).toBe(arrived);
    await move(-100, 0);
    for (let i = 0; i < 40; i++) await move(100, 0);
    expect(phone.last?.edgeCue).toBe(arrived! + 1);
  });

  test("the last phone to touch drives the one shared pointer", async () => {
    const second = await h.connectPhone();
    await move(10, 0, phone);
    const first = lastDraw().x;
    await move(10, 0, second);
    expect(lastDraw().x).toBeGreaterThan(first);
    for (let i = 0; i < 40; i++) await move(100, 0, second);
    expect(second.last?.edgeCue).toBeGreaterThan(0);
    expect(phone.last?.edgeCue).toBeUndefined();
  });

  test("it fades after about 5 s still, and the next touch brings it back where it was", async () => {
    await move(30, 30);
    const at = lastDraw();
    h.clock.advance(4900);
    expect(lastDraw().shown).toBe(true);
    h.clock.advance(200);
    expect(lastDraw()).toMatchObject({ shown: false });
    await move(0, 0);
    expect(lastDraw()).toMatchObject({ shown: true, x: at.x, y: at.y });
  });

  test("moving keeps it from fading", async () => {
    await move(5, 5);
    for (let i = 0; i < 4; i++) {
      h.clock.advance(3000);
      await move(1, 1);
    }
    expect(lastDraw().shown).toBe(true);
  });

  test("a D-pad press hides it at once", async () => {
    await move(5, 5);
    await send(phone, "down");
    expect(lastDraw().shown).toBe(false);
  });

  test("a Mac key or the Mac's own mouse hides it at once, and the next touch brings it back", async () => {
    await move(5, 5);
    h.app.hidePointer();
    expect(lastDraw().shown).toBe(false);
    await move(0, 0);
    expect(lastDraw().shown).toBe(true);
  });

  test("turning the mode off hides it", async () => {
    await move(5, 5);
    await send(phone, { command: "pointerMode", args: { on: false } });
    expect(lastDraw().shown).toBe(false);
  });

  test("going to a place where the mode is off hides it", async () => {
    await move(5, 5);
    await phone.press({ command: "openApp", args: { app: "tube" } });
    expect(lastDraw().shown).toBe(false);
  });

  test("a touch during Picture off only brings the picture back", async () => {
    await phone.press({ command: "openApp", args: { app: "tube" } });
    await send(phone, { command: "pointerMode", args: { on: true } });
    tube.emit({
      type: "playback",
      playback: { position: 30, duration: 600, paused: false, title: "Cat" },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    expect(h.screen.last.state.pictureOff).toBe(true);
    const inputs = h.screen.pointer.inputs.length;
    await send(phone, "pointerClick");
    expect(h.screen.last.state.pictureOff).toBe(false);
    expect(h.screen.pointer.inputs.length).toBe(inputs);
    expect(tube.pointerCalls.filter((c) => c.call !== "setMode")).toEqual([]);
  });
});

describe("Pointer mode: routing to the layer in front", () => {
  beforeEach(() => send(phone, { command: "pointerMode", args: { on: true } }));

  test("on a Couch page a move waits until the pointer rests, then goes to the page", async () => {
    await move(20, 10);
    expect(h.screen.pointer.inputs).toEqual([]);
    h.clock.advance(250);
    expect(h.screen.pointer.inputs).toEqual([]);
    h.clock.advance(100);
    expect(h.screen.pointer.inputs).toEqual([
      { layer: "page", type: "move", x: lastDraw().x, y: lastDraw().y },
    ]);
  });

  test("moving on again restarts the rest, so a passing pointer delivers nothing", async () => {
    for (let i = 0; i < 6; i++) {
      await move(10, 0);
      h.clock.advance(200);
    }
    expect(h.screen.pointer.inputs).toEqual([]);
  });

  test("a tap delivers the pending move right before the click", async () => {
    await move(20, 10);
    await send(phone, "pointerClick");
    const { x, y } = lastDraw();
    expect(h.screen.pointer.inputs).toEqual([
      { layer: "page", type: "move", x, y },
      { layer: "page", type: "click", x, y },
    ]);
    h.clock.advance(1000);
    expect(h.screen.pointer.inputs).toHaveLength(2);
  });

  test("a long press delivers a right-click", async () => {
    await move(20, 10);
    await send(phone, "pointerRightClick");
    expect(h.screen.pointer.inputs.at(-1)).toMatchObject({ layer: "page", type: "rightClick" });
  });

  test("Quick settings, when open, is the layer that gets it", async () => {
    await phone.press("quickSettings");
    expect(h.screen.last.quick).toBeDefined();
    await send(phone, "pointerClick");
    expect(h.screen.pointer.inputs.at(-1)).toMatchObject({ layer: "quick", type: "click" });
  });

  test("a question on a Couch page is the page's, so it gets it", async () => {
    await phone.press({ command: "openSettings" });
    h.app.askQuit();
    expect(h.screen.last.state.confirm).toBeDefined();
    await send(phone, "pointerClick");
    expect(h.screen.pointer.inputs.at(-1)).toMatchObject({ layer: "page", type: "click" });
  });

  test("a web App in front gets every move live, and its clicks, from its own mode", async () => {
    await phone.press({ command: "openApp", args: { app: "tube" } });
    await send(phone, { command: "pointerMode", args: { on: true } });
    expect(tube.pointerCalls).toContainEqual({ call: "setMode", args: [true] });
    await move(20, 10);
    const { x, y } = lastDraw();
    expect(tube.pointerCalls.at(-1)).toEqual({ call: "move", args: [x, y] });
    await send(phone, "pointerClick");
    expect(tube.pointerCalls.at(-1)).toEqual({ call: "click", args: [x, y] });
    await send(phone, "pointerRightClick");
    expect(tube.pointerCalls.at(-1)).toEqual({ call: "rightClick", args: [x, y] });
    expect(h.screen.pointer.inputs).toEqual([]);
    await send(phone, { command: "pointerMode", args: { on: false } });
    expect(tube.pointerCalls.at(-1)).toEqual({ call: "setMode", args: [false] });
  });

  test("leaving a web App lifts its pointer mode, and Home never sends App events", async () => {
    await phone.press({ command: "openApp", args: { app: "tube" } });
    await send(phone, { command: "pointerMode", args: { on: true } });
    await phone.press("home");
    expect(tube.pointerCalls.at(-1)).toEqual({ call: "setMode", args: [false] });
  });

  test("a scroll reaches the front Couch page at the pointer's position without moving it", async () => {
    await move(20, 10);
    const { x, y } = lastDraw();
    await scroll(0, -30);
    await scroll(-25, 0);
    expect(lastDraw()).toMatchObject({ x, y, shown: true });
    expect(h.screen.pointer.inputs).toEqual([
      { layer: "page", type: "scroll", x, y, dx: 0, dy: expect.any(Number) },
      { layer: "page", type: "scroll", x, y, dx: expect.any(Number), dy: 0 },
    ]);
    const [vert, horiz] = h.screen.pointer.inputs as Array<{ dx: number; dy: number }>;
    expect(vert!.dy).toBeLessThan(0);
    expect(horiz!.dx).toBeLessThan(0);
  });

  test("a huge scroll delta is clamped like a move", async () => {
    await scroll(0, -1e9);
    await scroll(0, -120);
    const [huge, max] = h.screen.pointer.inputs as Array<{ dy: number }>;
    expect(huge!.dy).toBe(max!.dy);
    expect(Math.abs(huge!.dy)).toBeLessThan(500);
  });

  test("scroll goes to Quick settings when open, and to a web App when it is in front", async () => {
    await phone.press("quickSettings");
    await scroll(0, -20);
    expect(h.screen.pointer.inputs.at(-1)).toMatchObject({ layer: "quick", type: "scroll" });

    await phone.press("quickSettings");
    await phone.press({ command: "openApp", args: { app: "tube" } });
    await send(phone, { command: "pointerMode", args: { on: true } });
    await move(15, 10);
    const { x, y } = lastDraw();
    const pageCount = h.screen.pointer.inputs.length;
    await scroll(-20, -15);
    const lastAppCall = tube.pointerCalls.at(-1);
    expect(lastAppCall?.call).toBe("scroll");
    expect(lastAppCall?.args.slice(0, 2)).toEqual([x, y]);
    expect(lastAppCall?.args[2] as number).toBeLessThan(0);
    expect(lastAppCall?.args[3] as number).toBeLessThan(0);
    expect(h.screen.pointer.inputs).toHaveLength(pageCount);
  });

  test("a scroll needs Pointer mode on, and during Picture off only brings the picture back", async () => {
    await send(phone, { command: "pointerMode", args: { on: false } });
    await scroll(0, -30);
    expect(h.screen.pointer.inputs).toEqual([]);

    await phone.press({ command: "openApp", args: { app: "tube" } });
    await send(phone, { command: "pointerMode", args: { on: true } });
    tube.emit({
      type: "playback",
      playback: { position: 30, duration: 600, paused: false, title: "Cat" },
    });
    await phone.waitFor(() => phone.last?.nowPlaying !== undefined);
    await phone.press({ command: "setPictureOff", args: { on: true } });
    await scroll(0, -30);
    expect(h.screen.last.state.pictureOff).toBe(false);
    expect(tube.pointerCalls.filter((c) => c.call === "scroll")).toEqual([]);
  });

  test("with Quick settings open over a web App, pointer events go to Quick settings and not the App", async () => {
    await phone.press({ command: "openApp", args: { app: "tube" } });
    await send(phone, { command: "pointerMode", args: { on: true } });
    await move(20, 10);
    const appCallsBefore = tube.pointerCalls.length;

    await phone.press("quickSettings");
    await move(15, 10);
    h.clock.advance(300);
    await send(phone, "pointerClick");
    await send(phone, "pointerRightClick");
    await scroll(0, -20);

    expect(tube.pointerCalls).toHaveLength(appCallsBefore);
    expect(h.screen.pointer.inputs.map((i) => `${i.layer}:${i.type}`)).toEqual([
      "quick:move",
      "quick:click",
      "quick:rightClick",
      "quick:scroll",
    ]);
  });

  test("YouTube, Netflix and BitChord expose their host's pointer while defaulting to the D-pad", async () => {
    const bitchordPort = new FakeYouTube();
    const custom = await startHarness(undefined, {
      apps: [
        {
          entry: entry("bitchord", "BitChord"),
          app: new BitChordApp(bitchordPort, new FakeClock()),
        },
      ],
    });
    const p = await custom.connectPhone();
    for (const [id, port] of [
      ["youtube", custom.youtube],
      ["netflix", custom.netflix],
      ["bitchord", bitchordPort],
    ] as const) {
      await p.press({ command: "openApp", args: { app: id } });
      expect(p.last?.pointerAvailable).toBe(true);
      expect(p.last?.pointer).toBeUndefined();

      await send(p, { command: "pointerMode", args: { on: true } });
      expect(p.last?.pointer).toBe(true);
      await move(12, 8, p);
      await send(p, "pointerClick");
      await send(p, "pointerRightClick");
      await scroll(0, -20, p);
      expect(port.pointerCalls.map((c) => c.call)).toEqual([
        "setMode",
        "move",
        "click",
        "rightClick",
        "scroll",
      ]);

      await send(p, { command: "pointerMode", args: { on: false } });
      expect(port.pointerCalls.at(-1)).toEqual({ call: "setMode", args: [false] });
      await p.press("home");
    }
    await custom.stop();
  });
});

describe("Pointer speed setting", () => {
  const openRemotes = async (p = phone) => {
    await p.press({ command: "openSettings" });
    expect(h.screen.last.state.view).toBe("settings");
    await p.press("ok");
    expect(h.screen.last.state.view).toBe("settingsRemotes");
  };

  const focusSpeed = async (p = phone) => {
    for (let i = 0; i < 10 && h.screen.last.focusedId !== "pointer-speed"; i++)
      await p.press("down");
    expect(h.screen.last.focusedId).toBe("pointer-speed");
  };

  test("the row is on Settings → Remotes and Devices, defaults to Normal, and can be changed from the Remote and the Mac", async () => {
    await openRemotes();
    expect(h.screen.last.grid.map((i) => i.label)).toContain("Pointer speed");
    expect(h.screen.last.pointerSpeed).toBe("normal");

    await focusSpeed();
    await phone.press("ok");
    expect(h.screen.last.pointerSpeed).toBe("fast");

    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.pointerSpeed).toBe("slow");

    await phone.press("ok");
    expect(h.screen.last.pointerSpeed).toBe("normal");
  });

  test("changing the setting applies at once: Slow moves less and Fast more than Normal, while a slow drag stays precise on every speed", async () => {
    await openRemotes();
    await focusSpeed();
    await send(phone, { command: "pointerMode", args: { on: true } });

    const measure = async (dx: number) => {
      await move(-1000, 0);
      await move(0, 0);
      const from = lastDraw().x;
      await move(dx, 0);
      return lastDraw().x - from;
    };

    const normalDrag = await measure(10);
    const normalSlow = await measure(1);

    await phone.press("ok");
    expect(h.screen.last.pointerSpeed).toBe("fast");
    const fastDrag = await measure(10);
    const fastSlow = await measure(1);

    await phone.press("ok");
    expect(h.screen.last.pointerSpeed).toBe("slow");
    const slowDrag = await measure(10);
    const slowSlow = await measure(1);

    expect(slowDrag).toBeGreaterThan(0);
    expect(slowDrag).toBeLessThan(normalDrag);
    expect(fastDrag).toBeGreaterThan(normalDrag);

    for (const [tiny, drag] of [
      [slowSlow, slowDrag],
      [normalSlow, normalDrag],
      [fastSlow, fastDrag],
    ] as const) {
      expect(tiny).toBeGreaterThan(0);
      expect(tiny).toBeLessThan(5);
      expect(drag / 10).toBeGreaterThan(tiny);
    }
  });

  test("the choice survives a restart and keeps its effect on pointer movement", async () => {
    await openRemotes();
    await focusSpeed();
    await phone.press("ok");
    expect(h.screen.last.pointerSpeed).toBe("fast");

    const store = h.store;
    for (const p of h.phones) p.close();
    await h.app.stop();

    const again = await startHarness(store);
    try {
      const p = await again.connectPhone();
      await p.press({ command: "openSettings" });
      await p.press("ok");
      expect(again.screen.last.state.view).toBe("settingsRemotes");
      expect(again.screen.last.pointerSpeed).toBe("fast");

      await send(p, { command: "pointerMode", args: { on: true } });
      await move(-1000, 0, p);
      await move(0, 0, p);
      const from = again.screen.pointer.draws.at(-1)!.x;
      await move(10, 0, p);
      const fastTravel = again.screen.pointer.draws.at(-1)!.x - from;

      // Cycle twice (Fast → Slow → Normal) and confirm Fast really was in effect after restart.
      for (let i = 0; i < 10 && again.screen.last.focusedId !== "pointer-speed"; i++)
        await p.press("down");
      await p.press("ok");
      await p.press("ok");
      expect(again.screen.last.pointerSpeed).toBe("normal");
      await move(-1000, 0, p);
      await move(0, 0, p);
      const fromNormal = again.screen.pointer.draws.at(-1)!.x;
      await move(10, 0, p);
      const normalTravel = again.screen.pointer.draws.at(-1)!.x - fromNormal;
      expect(fastTravel).toBeGreaterThan(normalTravel);
    } finally {
      await again.stop();
      h = await startHarness();
      phone = await h.connectPhone();
    }
  });
});
