// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { ScreenPayload } from "../../shared/protocol.ts";

type Mod = { render(p: ScreenPayload): void };
let page: Mod;
let screen: HTMLElement;

beforeAll(async () => {
  document.body.innerHTML = '<div id="screen"></div>';
  page = await import("./sound-output.ts");
  screen = document.getElementById("screen")!;
});

beforeEach(() => screen.replaceChildren());

function payload(sound: object): ScreenPayload {
  return {
    state: { view: "sound-output", remotes: 1 },
    focusedId: "default",
    grid: [{ id: "default", label: "System default", r: 0, c: 0 }],
    sound: { selected: "default", label: "System default", ...sound },
  } as unknown as ScreenPayload;
}

describe("Settings → Sound output", () => {
  test("shows a Netflix row that cannot take focus, from the payload's notes", () => {
    page.render(payload({ notes: ["Netflix · Follows the Mac's output"] }));
    const rows = Array.from(screen.querySelectorAll(".g-row"));
    const note = rows.find((r) => r.textContent?.includes("Netflix"))!;
    expect(note.textContent).toBe("Netflix · Follows the Mac's output");
    expect(note.getAttribute("data-id")).toBeNull();
    expect(screen.querySelector(".details-hint")).toBeNull();
  });

  test("shows no such row without notes", () => {
    page.render(payload({}));
    expect(screen.textContent).not.toContain("Follows the Mac");
  });
});
