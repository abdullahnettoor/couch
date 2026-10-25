import { describe, expect, test } from "vite-plus/test";
import { AppSpeed, PAGE_INPUT_WINDOW_MS, STALE_REPORT_WINDOW_MS } from "./app-speed.ts";

function setup() {
  let t = 100_000;
  const speed = new AppSpeed(() => t);
  return { speed, advance: (ms: number) => (t += ms) };
}

describe("AppSpeed", () => {
  test("a new video at 1× is left alone; a non-1× report right after is adopted at once", () => {
    const { speed } = setup();
    expect(speed.report("yt", "a", 1)).toBeUndefined();
    expect(speed.report("yt", "a", 1.5)).toBeUndefined();
    expect(speed.wanted("yt")).toBe(1.5);
  });

  test("a later drop to 1× with no input is re-applied, at most once per throttle", () => {
    const { speed, advance } = setup();
    speed.report("yt", "a", 1);
    speed.report("yt", "a", 1.5);
    expect(speed.report("yt", "a", 1)).toBe(1.5);
    advance(STALE_REPORT_WINDOW_MS - 1);
    expect(speed.report("yt", "a", 1)).toBeUndefined();
    advance(1);
    expect(speed.report("yt", "a", 1)).toBe(1.5);
  });

  test("a drop to 1× is kept within the input window and re-applied after it", () => {
    const { speed, advance } = setup();
    speed.report("yt", "a", 1);
    speed.report("yt", "a", 1.5);
    speed.input("yt");
    advance(PAGE_INPUT_WINDOW_MS);
    expect(speed.report("yt", "a", 1)).toBeUndefined();
    expect(speed.wanted("yt")).toBe(1);
    speed.report("yt", "a", 1.5);
    speed.input("yt");
    advance(PAGE_INPUT_WINDOW_MS + 1);
    expect(speed.report("yt", "a", 1)).toBe(1.5);
  });

  test("a new video carried over at another speed is set to 1×, even right after input", () => {
    const { speed } = setup();
    speed.report("yt", "a", 1);
    speed.report("yt", "a", 1.5);
    speed.input("yt");
    expect(speed.report("yt", "b", 1.5)).toBe(1);
    expect(speed.wanted("yt")).toBe(1);
  });

  test("a stale report just after Couch applied a speed isn't adopted, a later one is", () => {
    const { speed, advance } = setup();
    speed.command("yt", 2, "a");
    expect(speed.report("yt", "a", 1.5)).toBeUndefined();
    expect(speed.wanted("yt")).toBe(2);
    advance(STALE_REPORT_WINDOW_MS);
    expect(speed.report("yt", "a", 1.5)).toBeUndefined();
    expect(speed.wanted("yt")).toBe(1.5);
  });

  test("a phone command clears earlier page input", () => {
    const { speed, advance } = setup();
    speed.report("yt", "a", 1);
    speed.input("yt");
    speed.command("yt", 2, "a");
    advance(STALE_REPORT_WINDOW_MS);
    expect(speed.report("yt", "a", 1)).toBe(2);
    expect(speed.wanted("yt")).toBe(2);
  });

  test("input after a command counts again", () => {
    const { speed, advance } = setup();
    speed.command("yt", 2, "a");
    advance(500);
    speed.input("yt");
    expect(speed.report("yt", "a", 1)).toBeUndefined();
    expect(speed.wanted("yt")).toBe(1);
  });

  test("apps are independent, and clear forgets one", () => {
    const { speed } = setup();
    speed.command("yt", 2, "a");
    expect(speed.wanted("nf")).toBeUndefined();
    speed.clear("yt");
    expect(speed.wanted("yt")).toBeUndefined();
  });
});
