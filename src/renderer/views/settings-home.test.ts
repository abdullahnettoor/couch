// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { readCss } from "../testing/css-rules.ts";

const { prop } = readCss("glass.css");

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
    expect(prop(".wp-name", "white-space")).toBe("nowrap");
    expect(prop(".wp-name", "overflow")).toBe("hidden");
    expect(prop(".wp-name", "text-overflow")).toBe("ellipsis");
  });

  test("the focused picture's full name shows on one line under the row", () => {
    views.settingsHome!.render(payload("pic:folder:a.jpg"));
    const full = document.querySelector(".wp-full");
    expect(full?.textContent).toBe(LONG);
    expect(prop(".wp-full", "white-space")).toBe("nowrap");
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
