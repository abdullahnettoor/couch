import { describe, expect, test } from "vite-plus/test";
import { CursorHider } from "./cursor-hider.ts";
import { type CursorHost, type HostEvent, wireCursor } from "./cursor-lifecycle.ts";
import { FakeClock } from "./ports/fakes.ts";

function setup(focused = true) {
  const clock = new FakeClock();
  const mac = { visible: true };
  const moves = new Set<() => void>();
  const events = new Map<HostEvent, Array<() => void>>();
  let screen: ((playing: boolean) => void) | undefined;
  const host: CursorHost = {
    focused: () => focused,
    on: (event, cb) => events.set(event, [...(events.get(event) ?? []), cb]),
    onScreen: (cb) => (screen = cb),
  };
  const hider = new CursorHider({
    clock,
    onMouseMoved: (cb) => {
      moves.add(cb);
      return () => moves.delete(cb);
    },
    setHidden: (hidden) => (mac.visible = !hidden),
  });
  wireCursor(host, hider);
  return {
    mac,
    clock,
    emit: (e: HostEvent) => events.get(e)?.forEach((cb) => cb()),
    screen: (playing: boolean) => screen?.(playing),
  };
}

describe("cursor lifecycle", () => {
  test("hides while playing in an active Couch", () => {
    const { clock, mac, screen } = setup();
    screen(true);
    clock.advance(3100);
    expect(mac.visible).toBe(false);
  });

  test("blur releases explicitly; later Screen updates can't re-arm it", () => {
    const { clock, mac, emit, screen } = setup();
    screen(true);
    clock.advance(3100);
    emit("blur");
    expect(mac.visible).toBe(true);
    screen(true);
    screen(false);
    screen(true);
    clock.advance(10_000);
    expect(mac.visible).toBe(true);
  });

  test("refocus while playback continues starts hiding again", () => {
    const { clock, mac, emit, screen } = setup();
    screen(true);
    emit("blur");
    emit("focus");
    clock.advance(3100);
    expect(mac.visible).toBe(false);
  });

  test("hide releases, and focus alone doesn't re-arm until shown", () => {
    const { clock, mac, emit, screen } = setup();
    screen(true);
    clock.advance(3100);
    emit("hide");
    expect(mac.visible).toBe(true);
    emit("focus");
    clock.advance(10_000);
    expect(mac.visible).toBe(true);
    emit("show");
    clock.advance(3100);
    expect(mac.visible).toBe(false);
  });

  test("quit releases for good", () => {
    const { clock, mac, emit, screen } = setup();
    screen(true);
    clock.advance(3100);
    emit("quit");
    expect(mac.visible).toBe(true);
    emit("focus");
    screen(true);
    clock.advance(10_000);
    expect(mac.visible).toBe(true);
  });

  test("starts inactive when Couch isn't focused at wiring time", () => {
    const { clock, mac, emit, screen } = setup(false);
    screen(true);
    clock.advance(10_000);
    expect(mac.visible).toBe(true);
    emit("focus");
    clock.advance(3100);
    expect(mac.visible).toBe(false);
  });

  test("Home after playback shows the cursor", () => {
    const { clock, mac, screen } = setup();
    screen(true);
    clock.advance(3100);
    screen(false);
    expect(mac.visible).toBe(true);
  });
});
