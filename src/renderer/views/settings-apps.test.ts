// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { ScreenPayload } from "../../shared/protocol.ts";

let views: typeof import("./index.ts").VIEWS;
beforeAll(async () => {
  document.body.innerHTML = '<div id="screen"></div>';
  views = (await import("./index.ts")).VIEWS;
});
beforeEach(() => {
  document.getElementById("screen")!.replaceChildren();
  (window as unknown as { couch: object }).couch = { send: vi.fn() };
});

const homeApps = [
  { id: "youtube", label: "YouTube", icon: "<svg></svg>", shown: true },
  { id: "bitchord", label: "BitChord", icon: "<svg></svg>", shown: false, beta: true as const },
];
function payload(focusedId: string, extra: object = {}): ScreenPayload {
  const grid = [
    { id: "settings-app:youtube", label: "YouTube", r: 0, c: 0 },
    { id: "settings-app:bitchord", label: "BitChord", r: 1, c: 0 },
    { id: "text-size", label: "Text size: Larger", r: 2, c: 0 },
  ];
  return {
    state: { view: "settingsApps", remotes: 0 },
    focusedId,
    grid,
    homeApps,
    now: 0,
    pairingUrl: "http://x",
    ...extra,
  } as unknown as ScreenPayload;
}
const draw = (p: ScreenPayload) => views.settingsApps!.render(p);
const rows = () => [...document.querySelectorAll<HTMLElement>(".g-row")];

describe("Settings → Apps", () => {
  test("draws the household Text size row after the App rows, with its value", () => {
    draw(payload("settings-app:youtube"));
    const all = rows();
    expect(all.map((r) => r.querySelector(".g-row-label")?.textContent)).toEqual([
      "YouTube",
      "BitChord",
      "Text size",
    ]);
    expect(all[2]!.querySelector(".v")?.textContent).toBe("Larger");
    expect(all[0]!.querySelector(".g-row-logo")).not.toBeNull();
    expect(all[0]!.querySelector(".g-switch")).not.toBeNull();
    expect(all[2]!.querySelector(".g-switch")).toBeNull();
  });

  test("the row shows focus when the core focuses it", () => {
    draw(payload("text-size"));
    const focused = rows().filter((r) => r.classList.contains("focused"));
    expect(focused.map((r) => r.querySelector(".g-row-label")?.textContent)).toEqual(["Text size"]);
  });

  test("an App's menu over the list hides the household row", () => {
    draw(payload("text-size", { appMenu: { id: "youtube", label: "YouTube" } }));
    expect(
      rows().some(
        (r) =>
          r.querySelector(".g-row-label")?.textContent === "Text size" && !r.closest(".g-menu"),
      ),
    ).toBe(false);
  });
});
