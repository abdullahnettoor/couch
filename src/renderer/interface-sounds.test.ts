import { describe, expect, test } from "vite-plus/test";
import { soundGate } from "./interface-sounds.ts";

describe("Interface sounds' pace", () => {
  test("a held arrow ticks at most once per 70 ms", () => {
    const gate = soundGate();
    const times = [0, 30, 60, 70, 100, 140, 150, 210];
    expect(times.filter((t) => gate("move", t))).toEqual([0, 70, 140, 210]);
  });

  test("a bump shares the pace with moves", () => {
    const gate = soundGate();
    expect(gate("move", 0)).toBe(true);
    expect(gate("blocked", 20)).toBe(false);
    expect(gate("blocked", 80)).toBe(true);
  });

  test("Select and Back always play, and don't hold up the next tick", () => {
    const gate = soundGate();
    expect(gate("move", 0)).toBe(true);
    expect(gate("select", 10)).toBe(true);
    expect(gate("back", 15)).toBe(true);
    expect(gate("move", 70)).toBe(true);
  });
});
