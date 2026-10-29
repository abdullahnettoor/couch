import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { NATIVE_APP_CLASS, nativeAppFront, netflixEngine } from "./native-front.ts";

describe("the renderer is transparent while a native App view is in front", () => {
  const native = new Set(["netflix"]);

  test("only for an App that is a native view, and only while it is the front view", () => {
    expect(nativeAppFront({ view: "app", app: "netflix" }, native)).toBe(true);
    expect(nativeAppFront({ view: "app", app: "youtube" }, native)).toBe(false);
    expect(nativeAppFront({ view: "home" }, native)).toBe(false);
    expect(nativeAppFront({ view: "player" }, native)).toBe(false);
    expect(nativeAppFront({ view: "app" }, native)).toBe(false);
  });

  test("the renderer's stylesheet makes the page transparent for that class", () => {
    const css = readFileSync(
      join(import.meta.dirname, "../../renderer/player-overlay.css"),
      "utf8",
    );
    expect(css).toMatch(
      new RegExp(`body\\.${NATIVE_APP_CLASS}[^{]*\\{[^}]*background:\\s*transparent`),
    );
  });
});

describe("the Netflix engine", () => {
  test("is Chromium unless COUCH_NETFLIX_ENGINE=webkit and WebKit is available", () => {
    expect(netflixEngine({}, true)).toBe("chromium");
    expect(netflixEngine({ COUCH_NETFLIX_ENGINE: "chromium" }, true)).toBe("chromium");
    expect(netflixEngine({ COUCH_NETFLIX_ENGINE: "webkit" }, true)).toBe("webkit");
    expect(netflixEngine({ COUCH_NETFLIX_ENGINE: "webkit" }, false)).toBe("chromium");
  });
});
