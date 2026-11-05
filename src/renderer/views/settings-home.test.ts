// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { ScreenPayload } from "../../shared/protocol.ts";

const glass = document.createElement("style");
glass.textContent = readFileSync(join(import.meta.dirname, "../glass.css"), "utf8");
document.head.append(glass);
/** The rule written exactly for `selector` in glass.css. */
const rule = (selector: string) =>
  (
    Array.from(glass.sheet!.cssRules).find(
      (r) => (r as CSSStyleRule).selectorText === selector,
    ) as CSSStyleRule
  ).style;

let views: typeof import("./index.ts").VIEWS;
beforeAll(async () => {
  document.body.innerHTML = '<div id="screen"></div>';
  views = (await import("./index.ts")).VIEWS;
});
beforeEach(() => {
  document.getElementById("screen")!.replaceChildren();
  (window as unknown as { couch: object }).couch = { send: vi.fn() };
});

const LONG = "Dramatic scenery with a very long folder picture name";
function payload(focusedId: string): ScreenPayload {
  return {
    state: { view: "settingsHome", remotes: 0 },
    focusedId,
    grid: [],
    now: 0,
    pairingUrl: "http://x",
    home: {
      wallpaper: { kind: "builtin", id: "midnight" },
      pictures: [
        { kind: "folder", file: "a.jpg", label: LONG },
        { kind: "folder", file: "b.jpg", label: "Gargantua" },
      ],
    },
  } as unknown as ScreenPayload;
}

describe("wallpaper tile names", () => {
  test("a tile name is clipped to one line with an ellipsis", () => {
    const name = rule(".wp-name");
    expect(name.getPropertyValue("white-space")).toBe("nowrap");
    expect(name.getPropertyValue("overflow")).toBe("hidden");
    expect(name.getPropertyValue("text-overflow")).toBe("ellipsis");
  });

  test("the focused picture's full name shows on one line under the row", () => {
    views.settingsHome!.render(payload("pic:folder:a.jpg"));
    const full = document.querySelector(".wp-full");
    expect(full?.textContent).toBe(LONG);
    expect(rule(".wp-full").getPropertyValue("white-space")).toBe("nowrap");
  });

  test("the full name follows focus to another tile", () => {
    views.settingsHome!.render(payload("pic:folder:b.jpg"));
    expect(document.querySelector(".wp-full")?.textContent).toBe("Gargantua");
  });

  test("no full-name line while something other than a picture is focused", () => {
    views.settingsHome!.render(payload("artwork"));
    expect(document.querySelector(".wp-full")?.textContent ?? "").toBe("");
  });
});
