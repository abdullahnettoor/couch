// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { PointerSpeed } from "../../shared/pointer.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { REMOTES_ITEMS } from "../../shared/settings-grid.ts";

let views: typeof import("./index.ts").VIEWS;
beforeAll(async () => {
  document.body.innerHTML = '<div id="screen"></div>';
  views = (await import("./index.ts")).VIEWS;
});
beforeEach(() => {
  document.getElementById("screen")!.replaceChildren();
  (window as unknown as { couch: object }).couch = { send: vi.fn() };
});

function payload(pointerSpeed: PointerSpeed, focusedId = "add-phone"): ScreenPayload {
  return {
    state: { view: "settingsRemotes", remotes: 1 },
    focusedId,
    grid: REMOTES_ITEMS,
    listener: { available: true, on: false, running: false },
    pointerSpeed,
    now: 0,
    pairingUrl: "http://x",
  } as unknown as ScreenPayload;
}

const rows = () => [...document.querySelectorAll<HTMLElement>(".g-row")];

describe("Settings → Remotes and Devices", () => {
  test.each<[PointerSpeed, string]>([
    ["slow", "Slow"],
    ["normal", "Normal"],
    ["fast", "Fast"],
  ])("draws the Pointer speed row with %s shown as %s", (speed, label) => {
    views.settingsRemotes!.render(payload(speed, "pointer-speed"));
    const speedRow = rows().find(
      (r) => r.querySelector(".g-row-label")?.textContent === "Pointer speed",
    );
    expect(speedRow).toBeDefined();
    expect(speedRow!.querySelector(".v")?.textContent).toBe(label);
    expect(speedRow!.classList.contains("focused")).toBe(true);
  });
});
