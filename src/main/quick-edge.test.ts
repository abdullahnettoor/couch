import { describe, expect, test } from "vite-plus/test";
import { EdgeGesture } from "./quick-edge.ts";
import { wireCursor, type CursorHost, type HostEvent } from "./cursor-lifecycle.ts";
import { MouseMoves } from "./mouse-moves.ts";
import { FakeClock } from "./ports/fakes.ts";

function setup() {
  const clock = new FakeClock();
  const pointer: { at: { x: number; y: number } | undefined } = { at: { x: 300, y: 400 } };
  const listeners = new Set<() => void>();
  let opened = 0;
  const edge = new EdgeGesture({
    clock,
    onMouseMoved: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    position: () => pointer.at,
    open: () => opened++,
  });
  const move = (x: number, y = 400) => {
    pointer.at = { x, y };
    listeners.forEach((cb) => cb());
  };
  const leave = () => {
    pointer.at = undefined;
    listeners.forEach((cb) => cb());
  };
  return { clock, edge, move, leave, listeners, opened: () => opened };
}

describe("the left-edge gesture", () => {
  test("opens once the pointer has moved onto the far left edge and rested for half a second", () => {
    const { clock, edge, move, opened } = setup();
    edge.start();
    move(120);
    move(0);
    clock.advance(400);
    expect(opened()).toBe(0);
    clock.advance(150);
    expect(opened()).toBe(1);
    clock.advance(5000);
    expect(opened()).toBe(1);
  });

  test("a pointer parked at the edge that never moves never opens it", () => {
    const { clock, edge, move, opened } = setup();
    move(0, 500);
    edge.start();
    clock.advance(10_000);
    expect(opened()).toBe(0);
  });

  test("leaving the edge, or moving off the Screen, cancels the wait", () => {
    const { clock, edge, move, leave, opened } = setup();
    edge.start();
    move(0);
    clock.advance(300);
    move(80);
    clock.advance(1000);
    expect(opened()).toBe(0);
    move(0);
    clock.advance(300);
    leave();
    clock.advance(1000);
    expect(opened()).toBe(0);
  });

  test("moving along the edge restarts the wait; it opens again only after leaving and coming back", () => {
    const { clock, edge, move, opened } = setup();
    edge.start();
    move(0, 400);
    clock.advance(400);
    move(0, 300);
    clock.advance(400);
    expect(opened()).toBe(0);
    clock.advance(150);
    expect(opened()).toBe(1);
    move(0, 200);
    clock.advance(2000);
    expect(opened()).toBe(1);
    move(200);
    move(0);
    clock.advance(600);
    expect(opened()).toBe(2);
  });

  test("stopping cancels a pending wait and stops listening; starting again needs a new movement", () => {
    const { clock, edge, move, listeners, opened } = setup();
    edge.start();
    move(0);
    clock.advance(300);
    edge.stop();
    expect(listeners.size).toBe(0);
    clock.advance(2000);
    expect(opened()).toBe(0);
    edge.start();
    clock.advance(2000);
    expect(opened()).toBe(0);
    move(0);
    clock.advance(600);
    expect(opened()).toBe(1);
  });

  test("blur and hide reset it, through the same lifecycle as the cursor; focus and show bring it back", () => {
    const { clock, edge, move, opened } = setup();
    const events = new Map<HostEvent, Array<() => void>>();
    const host: CursorHost = {
      focused: () => true,
      on: (event, cb) => events.set(event, [...(events.get(event) ?? []), cb]),
      onScreen: (cb) => cb(true),
    };
    wireCursor(host, { playing: () => edge.start(), release: () => edge.stop() });
    const emit = (e: HostEvent) => events.get(e)?.forEach((cb) => cb());

    move(0);
    clock.advance(300);
    emit("blur");
    clock.advance(2000);
    expect(opened()).toBe(0);
    move(0);
    clock.advance(2000);
    expect(opened()).toBe(0);
    emit("focus");
    move(0);
    clock.advance(600);
    expect(opened()).toBe(1);

    emit("hide");
    move(200);
    move(0);
    clock.advance(2000);
    expect(opened()).toBe(1);
    emit("show");
    move(0);
    clock.advance(600);
    expect(opened()).toBe(2);
  });

  test("shares the one native subscription with the cursor hider", () => {
    const clock = new FakeClock();
    let starts = 0;
    const moves = new MouseMoves(() => (starts++, () => {}));
    const edge = new EdgeGesture({
      clock,
      onMouseMoved: moves.subscribe,
      position: () => ({ x: 0, y: 0 }),
      open: () => {},
    });
    moves.subscribe(() => {});
    edge.start();
    expect(starts).toBe(1);
  });
});
