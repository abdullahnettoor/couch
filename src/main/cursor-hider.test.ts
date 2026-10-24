import { describe, expect, test } from "vite-plus/test";
import { CursorHider } from "./cursor-hider.ts";
import { FakeClock } from "./ports/fakes.ts";

/** A Mac whose cursor reveals itself on any movement, like setHiddenUntilMouseMoves. */
function setup() {
  const clock = new FakeClock();
  const calls: boolean[] = [];
  const listeners = new Set<() => void>();
  const mac = { visible: true };
  const hider = new CursorHider({
    clock,
    onMouseMoved: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setHidden: (hidden) => {
      calls.push(hidden);
      mac.visible = !hidden;
    },
  });
  /** The mouse moves (even if it ends where it began): macOS reveals the cursor, then we hear. */
  const move = (): void => {
    mac.visible = true;
    for (const cb of listeners) cb();
  };
  return { clock, calls, hider, mac, move, watching: () => listeners.size };
}

describe("hiding the cursor during playback", () => {
  test("hides after about 3 s at rest, even when the mouse never moved since playback began", () => {
    const { clock, calls, hider } = setup();
    hider.playing(true);
    clock.advance(2900);
    expect(calls).toEqual([]);
    clock.advance(200);
    expect(calls).toEqual([true]);
  });

  test("does nothing on Home, browse pages and other views", () => {
    const { clock, calls, hider, watching } = setup();
    hider.playing(false);
    clock.advance(10_000);
    expect(calls).toEqual([]);
    expect(watching()).toBe(0);
  });

  test("movement shows it again and restarts the timer", () => {
    const { clock, calls, hider, mac, move } = setup();
    hider.playing(true);
    clock.advance(3500);
    move();
    expect(mac.visible).toBe(true);
    clock.advance(2900);
    expect(calls).toEqual([true, false]);
    clock.advance(200);
    expect(calls).toEqual([true, false, true]);
    expect(mac.visible).toBe(false);
  });

  test("movement before the delay is up postpones hiding", () => {
    const { clock, calls, hider, move } = setup();
    hider.playing(true);
    clock.advance(2000);
    move();
    clock.advance(2500);
    expect(calls).toEqual([]);
    clock.advance(600);
    expect(calls).toEqual([true]);
  });

  test("a mouse that leaves and returns to the same spot still re-arms hiding", () => {
    const { clock, hider, mac, move } = setup();
    hider.playing(true);
    clock.advance(3500);
    expect(mac.visible).toBe(false);
    move();
    move();
    expect(mac.visible).toBe(true);
    clock.advance(3100);
    expect(mac.visible).toBe(false);
  });

  test("leaving playback shows the cursor at once and stops watching", () => {
    const { clock, calls, hider, mac, watching } = setup();
    hider.playing(true);
    clock.advance(3500);
    hider.playing(false);
    expect(mac.visible).toBe(true);
    expect(watching()).toBe(0);
    clock.advance(10_000);
    expect(calls).toEqual([true, false]);
  });

  test("release always leaves the cursor visible, even if hiding is only pending", () => {
    const { clock, calls, hider, mac } = setup();
    hider.playing(true);
    clock.advance(1000);
    hider.release();
    expect(calls.at(-1)).toBe(false);
    expect(mac.visible).toBe(true);
    clock.advance(10_000);
    expect(mac.visible).toBe(true);
    hider.playing(true);
    clock.advance(3100);
    expect(mac.visible).toBe(false);
  });

  test("repeated playing(true) reports don't restart the timer", () => {
    const { clock, calls, hider } = setup();
    hider.playing(true);
    clock.advance(2000);
    hider.playing(true);
    clock.advance(1100);
    expect(calls).toEqual([true]);
  });
});
