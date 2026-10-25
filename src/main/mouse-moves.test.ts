import { describe, expect, test } from "vite-plus/test";
import { MouseMoves } from "./mouse-moves.ts";

function setup() {
  const native = { starts: 0, stops: 0, emit: () => {} };
  const moves = new MouseMoves((cb) => {
    native.starts++;
    native.emit = cb;
    return () => native.stops++;
  });
  return { native, moves };
}

describe("the shared mouse-moved subscription", () => {
  test("two listeners share one native watcher and both hear every movement", () => {
    const { native, moves } = setup();
    const heard: string[] = [];
    const stopA = moves.subscribe(() => heard.push("a"));
    const stopB = moves.subscribe(() => heard.push("b"));
    expect(native.starts).toBe(1);
    native.emit();
    expect(heard).toEqual(["a", "b"]);
    stopA();
    expect(native.stops).toBe(0);
    native.emit();
    expect(heard).toEqual(["a", "b", "b"]);
    stopB();
    expect(native.stops).toBe(1);
  });

  test("watches again after everyone has stopped", () => {
    const { native, moves } = setup();
    moves.subscribe(() => {})();
    moves.subscribe(() => {});
    expect(native.starts).toBe(2);
  });

  test("stopping twice does not stop the others", () => {
    const { native, moves } = setup();
    const stopA = moves.subscribe(() => {});
    moves.subscribe(() => {});
    stopA();
    stopA();
    expect(native.stops).toBe(0);
  });
});
