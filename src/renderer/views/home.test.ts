// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { LibraryEntry, ScreenPayload } from "../../shared/protocol.ts";
import { WALLPAPERS, wallpaperVars } from "../../shared/wallpapers.ts";

type Mod = { render(p: ScreenPayload): void };
let home: Mod;
let settingsHome: Mod;
let screen: HTMLElement;

beforeAll(async () => {
  document.body.innerHTML = '<div id="screen"></div>';
  const style = document.createElement("style");
  style.textContent = ["../home.css", "../glass.css"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
    .join("\n");
  document.head.append(style);
  home = await import("./home.ts");
  settingsHome = await import("./settings-home.ts");
  screen = document.getElementById("screen")!;
});

beforeEach(() => screen.replaceChildren());

const film: LibraryEntry = {
  path: "/films/a.mkv",
  title: "A Film",
  hue: 200,
  backdrop: "file:///a.jpg",
} as LibraryEntry;

function payload(over: Partial<ScreenPayload> & { view?: string } = {}): ScreenPayload {
  const { view, ...rest } = over;
  return {
    now: Date.UTC(2026, 0, 1, 20, 0),
    state: { view: view ?? "home", remotes: 1 },
    focusedId: "resume",
    grid: [],
    pairingUrl: "http://x",
    homeVideos: [film],
    home: { wallpaper: { kind: "builtin", id: "couch" }, artwork: true },
    ...rest,
  } as unknown as ScreenPayload;
}

const homeEl = () => screen.querySelector(".home") as HTMLElement;
const cls = (n: Element) => n.className.split(" ");

describe("Home renders every wallpaper", () => {
  for (const w of WALLPAPERS) {
    for (const artwork of [true, false]) {
      test(`${w.id}, artwork ${artwork ? "on" : "off"}`, () => {
        home.render(
          payload({
            home: { wallpaper: { kind: "builtin", id: w.id }, artwork },
            hero: film,
          }),
        );
        const view = homeEl();
        for (const [name, value] of Object.entries(wallpaperVars(w.id)))
          expect(view.style.getPropertyValue(name), name).toBe(value);
        const art = view.querySelector(".h-bg")!;
        expect(cls(art).includes("on")).toBe(artwork);
        expect(cls(view).includes("no-art")).toBe(!artwork);
        expect(view.querySelector(".h-scrim")).not.toBeNull();
      });
    }

    test(`${w.id}, ambient`, () => {
      home.render(
        payload({
          home: { wallpaper: { kind: "builtin", id: w.id }, artwork: true },
          ambient: true,
        }),
      );
      expect(cls(homeEl()).includes("ambient")).toBe(true);
      expect(homeEl().style.getPropertyValue("--wp-base")).toBe(wallpaperVars(w.id)["--wp-base"]);
      expect(homeEl().querySelector(".h-scrim")).not.toBeNull();
    });
  }

  test("the preview, when present, wins over the saved wallpaper", () => {
    home.render(
      payload({
        home: {
          wallpaper: { kind: "builtin", id: "couch" },
          preview: { kind: "builtin", id: "ember" },
          artwork: true,
        },
      }),
    );
    expect(homeEl().style.getPropertyValue("--wp-base")).toBe(wallpaperVars("ember")["--wp-base"]);
  });
});

describe("Home's scrim", () => {
  test("sits over the wallpaper and under the artwork, clock and tiles", () => {
    home.render(payload());
    const order = Array.from(homeEl().children).map((c) => c.className.split(" ")[0]);
    const at = (c: string) => order.indexOf(c);
    expect(at("h-scrim")).toBeGreaterThan(at("h-drift"));
    for (const above of ["h-clock", "h-hero", "h-chrome"])
      expect(at("h-scrim"), above).toBeLessThan(at(above));
  });

  test("the stylesheet gives it a gradient and keeps it visible", () => {
    home.render(payload());
    const rule = Array.from(document.styleSheets)
      .flatMap((s) => Array.from(s.cssRules))
      .find((r) => (r as CSSStyleRule).selectorText === ".h-scrim") as CSSStyleRule;
    expect(rule.style.getPropertyValue("position")).toBe("absolute");
    expect(rule.style.getPropertyValue("inset")).toBe("0");
    expect(rule.style.getPropertyValue("opacity")).toBe("");
    expect(rule.style.getPropertyValue("display")).not.toBe("none");
  });
});

describe("Settings → Home keeps the real Home mounted", () => {
  const page = (focusedId: string, saved = "couch") =>
    payload({
      view: "settingsHome",
      focusedId,
      home: {
        wallpaper: { kind: "builtin", id: saved },
        preview: { kind: "builtin", id: focusedId.replace("wp:", "") },
        artwork: true,
      },
    });

  test("Home stays under the page, and its variables follow focus", () => {
    settingsHome.render(page("wp:couch"));
    const first = homeEl();
    expect(first).not.toBeNull();
    expect(first.querySelector(".h-scrim")).not.toBeNull();
    expect(first.querySelector(".h-clock")).not.toBeNull();
    expect(first.querySelector(".h-row")).not.toBeNull();
    for (const w of WALLPAPERS) {
      settingsHome.render(page(`wp:${w.id}`));
      expect(homeEl()).toBe(first);
      expect(homeEl().style.getPropertyValue("--wp-base")).toBe(wallpaperVars(w.id)["--wp-base"]);
    }
    expect(screen.querySelectorAll(".wp-panel").length).toBe(1);
  });

  test("In use marks the saved wallpaper, not the focused one", () => {
    settingsHome.render(page("wp:ocean", "dusk"));
    const chosen = Array.from(screen.querySelectorAll(".wp-tile.chosen")).map(
      (t) => t.querySelector(".wp-name")!.textContent,
    );
    expect(chosen).toEqual(["Dusk"]);
    expect(screen.querySelector(".wp-tile.focused .wp-name")!.textContent).toBe("Ocean");
  });

  test("the six tiles share one scrolling row", () => {
    settingsHome.render(page("wp:forest"));
    const row = screen.querySelector(".wp-tiles")!;
    expect(row.querySelectorAll(".wp-tile").length).toBe(6);
    const rule = Array.from(document.styleSheets)
      .flatMap((s) => Array.from(s.cssRules))
      .find((r) => (r as CSSStyleRule).selectorText === ".wp-tiles") as CSSStyleRule;
    expect(rule.style.getPropertyValue("display")).toBe("flex");
    expect(rule.style.getPropertyValue("flex-wrap")).not.toBe("wrap");
    expect(rule.style.getPropertyValue("overflow-x")).toBe("auto");
  });

  test("leaving the page removes the panel; Home alone has none", () => {
    settingsHome.render(page("wp:couch"));
    home.render(payload());
    expect(screen.querySelector(".wp-panel")).toBeNull();
  });
});
