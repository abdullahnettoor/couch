import { describe, expect, test } from "vite-plus/test";
import { CursorHider } from "./cursor-hider.ts";
import { FakeClock } from "./ports/fakes.ts";

function setup() {
  const clock = new FakeClock();
  const pointer = { x: 500, y: 400 };
  const calls: boolean[] = [];
  const hider = new CursorHider({
    clock,
    pointer: () => ({ ...pointer }),
    setHidden: (hidden) => calls.push(hidden),
  });
  return { clock, pointer, calls, hider };
}

describe("hiding the cursor during playback", () => {
  test("hides after about 3 s at rest, even when the mouse never moved since playback began", () => {
    const { clock, calls, hider } = setup();
    hider.playing(true);
    clock.advance(2500);
    expect(calls).toEqual([]);
    clock.advance(1000);
    expect(calls).toEqual([true]);
  });

  test("does nothing on Home, browse pages and other views", () => {
    const { clock, calls, hider } = setup();
    hider.playing(false);
    clock.advance(10_000);
    expect(calls).toEqual([]);
  });

  test("movement shows it again and restarts the timer", () => {
    const { clock, pointer, calls, hider } = setup();
    hider.playing(true);
    clock.advance(3500);
    pointer.x += 40;
    clock.advance(500);
    expect(calls).toEqual([true, false]);
    clock.advance(2000);
    expect(calls).toEqual([true, false]);
    clock.advance(1500);
    expect(calls).toEqual([true, false, true]);
  });

  test("movement before the delay is up postpones hiding", () => {
    const { clock, pointer, calls, hider } = setup();
    hider.playing(true);
    clock.advance(2000);
    pointer.y += 10;
    clock.advance(2500);
    expect(calls).toEqual([]);
    clock.advance(1000);
    expect(calls).toEqual([true]);
  });

  test("leaving playback shows the cursor at once", () => {
    const { clock, calls, hider } = setup();
    hider.playing(true);
    clock.advance(3500);
    hider.playing(false);
    expect(calls).toEqual([true, false]);
    clock.advance(10_000);
    expect(calls).toEqual([true, false]);
  });

  test("losing focus or quitting shows it and stops hiding until playback is told again", () => {
    const { clock, calls, hider } = setup();
    hider.playing(true);
    clock.advance(3500);
    hider.release();
    expect(calls).toEqual([true, false]);
    clock.advance(10_000);
    expect(calls).toEqual([true, false]);
    hider.playing(true);
    clock.advance(3500);
    expect(calls).toEqual([true, false, true]);
  });

  test("repeated playing(true) reports don't restart the timer", () => {
    const { clock, calls, hider } = setup();
    hider.playing(true);
    clock.advance(2000);
    hider.playing(true);
    clock.advance(1200);
    expect(calls).toEqual([true]);
  });
});
