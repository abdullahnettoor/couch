import { describe, expect, test } from "vite-plus/test";
import { planPhoto } from "./photo-plan.ts";

const a = { url: "file:///a.jpg", dim: 0.3 };
const b = { url: "file:///b.jpg", dim: 0.5 };

describe("the picture on Home across a cold cache", () => {
  test("the next picture is not converted yet: the current one stays, never Couch", () => {
    expect(planPhoto(a, "picture", undefined)).toBe("keep");
  });
  test("then it is ready: it loads (and crossfades) before it replaces the old one", () => {
    expect(planPhoto(a, "picture", b)).toBe("load");
    expect(planPhoto(b, "picture", b)).toBe("same");
  });
  test("with nothing shown yet, a picture loads when ready and waits when not", () => {
    expect(planPhoto(undefined, "picture", a)).toBe("load");
    expect(planPhoto(undefined, "picture", undefined)).toBe("keep");
  });
  test("only a built-in wallpaper clears the picture", () => {
    expect(planPhoto(a, "builtin", undefined)).toBe("clear");
  });
});
