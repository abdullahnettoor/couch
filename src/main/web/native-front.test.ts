import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { NATIVE_APP_CLASS, nativeAppFront, chooseEngine } from "./native-front.ts";

describe("the renderer is transparent while a native App view is in front", () => {
  const native = new Set(["netflix"]);

  test("only for an App that is a native view, and only while it is the front view", () => {
    expect(nativeAppFront({ view: "app", app: "netflix" }, native)).toBe(true);
    expect(nativeAppFront({ view: "app", app: "youtube" }, native)).toBe(false);
    expect(nativeAppFront({ view: "home" }, native)).toBe(false);
    expect(nativeAppFront({ view: "player" }, native)).toBe(false);
    expect(nativeAppFront({ view: "app" }, native)).toBe(false);
  });

  test("the App error screen is Couch's own opaque screen: not transparent, so a failed view never shows through", () => {
    expect(nativeAppFront({ view: "appError", app: "netflix" }, native)).toBe(false);
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

describe("choosing the Netflix engine", () => {
  const yes = { available: true } as const;
  const no = { available: false, reason: "FairPlay isn't available on this Mac" } as const;

  test("WebKit is the default where FairPlay is available", () => {
    expect(chooseEngine({ stored: undefined, env: {}, webkit: yes })).toEqual({ engine: "webkit" });
  });

  test("Chromium is the fallback, with the reason, where it isn't", () => {
    expect(chooseEngine({ stored: undefined, env: {}, webkit: no })).toEqual({
      engine: "chromium",
      reason: no.reason,
    });
  });

  test("a stored WebKit choice is only as good as FairPlay: it falls back with the reason and comes back with it", () => {
    expect(chooseEngine({ stored: "webkit", env: {}, webkit: no })).toEqual({
      engine: "chromium",
      reason: no.reason,
    });
    expect(chooseEngine({ stored: "webkit", env: {}, webkit: yes })).toEqual({ engine: "webkit" });
  });

  test("a stored Chromium choice is honoured even where WebKit is available, and needs no reason", () => {
    expect(chooseEngine({ stored: "chromium", env: {}, webkit: yes })).toEqual({
      engine: "chromium",
    });
  });

  test("COUCH_NETFLIX_ENGINE is a developer override over the stored choice", () => {
    expect(
      chooseEngine({ stored: "chromium", env: { COUCH_NETFLIX_ENGINE: "webkit" }, webkit: yes }),
    ).toEqual({ engine: "webkit" });
    expect(
      chooseEngine({ stored: "webkit", env: { COUCH_NETFLIX_ENGINE: "chromium" }, webkit: yes }),
    ).toEqual({ engine: "chromium" });
    expect(
      chooseEngine({ stored: undefined, env: { COUCH_NETFLIX_ENGINE: "webkit" }, webkit: no }),
    ).toEqual({ engine: "chromium", reason: no.reason });
  });

  test("any other value of the variable is ignored", () => {
    expect(
      chooseEngine({ stored: "chromium", env: { COUCH_NETFLIX_ENGINE: "other" }, webkit: yes }),
    ).toEqual({ engine: "chromium" });
  });
});
