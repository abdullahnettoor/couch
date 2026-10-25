import { describe, expect, test } from "vite-plus/test";
import { EdgeDwell } from "./quick-edge.ts";

describe("the left-edge gesture", () => {
  test("fires once the pointer has rested at the far left edge for half a second", () => {
    const edge = new EdgeDwell();
    expect(edge.sample(300, 400, 0)).toBe(false);
    expect(edge.sample(0, 400, 100)).toBe(false);
    expect(edge.sample(0, 400, 400)).toBe(false);
    expect(edge.sample(0, 400, 600)).toBe(true);
    expect(edge.sample(0, 400, 900)).toBe(false);
  });

  test("never fires for a pointer that was already resting at the edge and has not moved", () => {
    const edge = new EdgeDwell();
    for (let t = 0; t < 5000; t += 100) expect(edge.sample(0, 500, t)).toBe(false);
  });

  test("leaving the edge before half a second cancels it", () => {
    const edge = new EdgeDwell();
    edge.sample(200, 400, 0);
    edge.sample(0, 400, 100);
    expect(edge.sample(80, 400, 300)).toBe(false);
    expect(edge.sample(80, 400, 800)).toBe(false);
  });

  test("moving along the edge restarts the wait, and it fires again only after leaving and coming back", () => {
    const edge = new EdgeDwell();
    edge.sample(100, 400, 0);
    edge.sample(0, 400, 100);
    expect(edge.sample(0, 300, 500)).toBe(false);
    expect(edge.sample(0, 300, 1100)).toBe(true);
    expect(edge.sample(0, 300, 2000)).toBe(false);
    edge.sample(200, 300, 2100);
    edge.sample(0, 300, 2200);
    expect(edge.sample(0, 300, 2800)).toBe(true);
  });
});
