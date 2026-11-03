// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { ICON_PATHS } from "../../shared/icons.ts";

type Mod = { render(p: ScreenPayload): void };
let page: Mod;
let topbar: (p: ScreenPayload) => HTMLElement;
let screen: HTMLElement;

beforeAll(async () => {
  document.body.innerHTML = '<div id="screen"></div>';
  page = await import("./about.ts");
  topbar = (await import("./glass.ts")).topbar;
  screen = document.getElementById("screen")!;
});

beforeEach(() => screen.replaceChildren());

const grid = [
  { id: "check", label: "Check for updates", r: 0, c: 0 },
  { id: "restart", label: "Restart to update", r: 1, c: 0 },
  { id: "beta", label: "Beta updates", r: 2, c: 0 },
];

describe("Settings → About", () => {
  test("the version is a line focus can't land on; each row shows its state", () => {
    page.render({
      state: { view: "about", remotes: 0 },
      focusedId: "restart",
      grid,
      about: { version: "0.2.0 (12) · Beta", check: "0.2.1 is ready", beta: true },
    } as unknown as ScreenPayload);
    const version = screen.querySelector(".g-row-note")!;
    expect(version.textContent).toBe("Version0.2.0 (12) · Beta");
    expect(version.getAttribute("data-id")).toBeNull();
    const rows = Array.from(screen.querySelectorAll("[data-id]"));
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["check", "restart", "beta"]);
    expect(rows[0]!.textContent).toContain("0.2.1 is ready");
    expect(rows[1]!.classList.contains("focused")).toBe(true);
    expect(rows[2]!.textContent).toContain("On");
  });
});

describe("Home's top strip", () => {
  const home = (withUpdate: boolean, focusedId = "youtube") =>
    ({
      state: { view: "home", remotes: 0 },
      focusedId,
      now: 0,
      timeFormat: "24h",
      grid: [
        ...(withUpdate ? [{ id: "update", label: "Update ready", r: 0, c: -1 }] : []),
        { id: "settings", label: "Settings", r: 0, c: 0 },
      ],
    }) as unknown as ScreenPayload;

  test("shows the update icon beside the gear, in the gear's style, only when the core offers it", () => {
    expect(topbar(home(false)).querySelector('[data-id="update"]')).toBeNull();
    const bar = topbar(home(true, "update"));
    const icon = bar.querySelector('[data-id="update"]')!;
    expect(icon.className).toBe("tb-gear focused");
    expect(icon.innerHTML).toContain(ICON_PATHS.update.slice(0, 40));
    expect(icon.nextElementSibling?.getAttribute("data-id")).toBe("settings");
  });
});
