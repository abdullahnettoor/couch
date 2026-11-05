// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { GLASS } from "../../shared/look.ts";
import type { LibraryEntry, ScreenPayload } from "../../shared/protocol.ts";
import { WALLPAPERS, wallpaperVars, type PictureTile } from "../../shared/wallpapers.ts";

/** Images load when a test says so: a picture only replaces the one on screen once it has loaded. */
class FakeImage {
  static pending: FakeImage[] = [];
  onload: (() => void) | undefined;
  onerror: (() => void) | undefined;
  url = "";
  set src(v: string) {
    this.url = v;
    FakeImage.pending.push(this);
  }
}
vi.stubGlobal("Image", FakeImage);
const loaded = () => {
  for (const image of FakeImage.pending.splice(0)) image.onload?.();
};

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

  test("Home holds still under the page and moves again on Home", () => {
    settingsHome.render(page("wp:dusk"));
    expect(cls(homeEl()).includes("still")).toBe(true);
    home.render(payload({ view: "home" }));
    expect(cls(homeEl()).includes("still")).toBe(false);
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

describe("Home with a picture from the Mac", () => {
  const pictures: PictureTile[] = [
    {
      kind: "mac",
      label: "Same as Mac",
      url: "file:///u/wallpapers/aaaaaaaaaaaa.jpg",
      thumb: "file:///u/wallpapers/aaaaaaaaaaaa.thumb.jpg",
      dim: 0.4,
    },
    {
      kind: "folder",
      file: "b.jpg",
      label: "B",
      url: "file:///u/wallpapers/bbbbbbbbbbbb.jpg",
      thumb: "file:///u/wallpapers/bbbbbbbbbbbb.thumb.jpg",
      dim: 0.6,
    },
    { kind: "apple", file: "Mac Blue.heic", label: "Mac Blue" },
  ];
  const withPhoto = (
    choice: NonNullable<ScreenPayload["home"]>["wallpaper"],
    extra: Partial<ScreenPayload> = {},
  ) => payload({ home: { wallpaper: choice, artwork: true, pictures }, ...extra });
  const bPhoto = { kind: "folder", file: "b.jpg" } as const;
  const rule = (selector: string) =>
    Array.from(document.styleSheets)
      .flatMap((s) => Array.from(s.cssRules))
      .find((r) => (r as CSSStyleRule).selectorText === selector) as CSSStyleRule | undefined;

  test("the picture and its dim are set as variables and the photo layer is on", () => {
    home.render(withPhoto(bPhoto));
    loaded();
    expect(cls(homeEl()).includes("photo")).toBe(true);
    expect(homeEl().style.getPropertyValue("--wp-photo")).toBe(
      'url("file:///u/wallpapers/bbbbbbbbbbbb.jpg")',
    );
    expect(homeEl().style.getPropertyValue("--wp-dim")).toBe("0.6");
  });

  test("Same as Mac draws its picture", () => {
    home.render(withPhoto({ kind: "mac" }));
    loaded();
    expect(homeEl().style.getPropertyValue("--wp-dim")).toBe("0.4");
  });

  test("a built-in after a picture clears it", () => {
    home.render(withPhoto({ kind: "mac" }));
    loaded();
    home.render(payload());
    expect(cls(homeEl()).includes("photo")).toBe(false);
    expect(homeEl().style.getPropertyValue("--wp-photo")).toBe("");
  });

  test("a picture that is not ready yet, or not in the list, draws as Couch", () => {
    home.render(withPhoto({ kind: "apple", file: "Mac Blue.heic" }));
    expect(cls(homeEl()).includes("photo")).toBe(false);
    home.render(withPhoto({ kind: "folder", file: "gone.jpg" }));
    expect(cls(homeEl()).includes("photo")).toBe(false);
    expect(homeEl().style.getPropertyValue("--wp-base")).toBe(wallpaperVars("couch")["--wp-base"]);
  });

  test("the preview picture wins over the saved wallpaper", () => {
    home.render(
      payload({
        home: {
          wallpaper: { kind: "builtin", id: "couch" },
          preview: { kind: "mac" },
          artwork: true,
          pictures,
        },
      }),
    );
    loaded();
    expect(homeEl().style.getPropertyValue("--wp-dim")).toBe("0.4");
  });

  test("cold cache: the current picture stays until the next one is converted and loaded, then it crossfades; never Couch", () => {
    const layer = () => homeEl().querySelectorAll(".h-photo-prev").length;
    home.render(withPhoto({ kind: "mac" }));
    loaded();
    const a = homeEl().style.getPropertyValue("--wp-photo");
    expect(a).toContain("aaaaaaaaaaaa");
    // The slideshow (or a choice) points at a picture whose copy doesn't exist yet.
    home.render(withPhoto({ kind: "apple", file: "Mac Blue.heic" }));
    loaded();
    expect(cls(homeEl()).includes("photo")).toBe(true);
    expect(homeEl().style.getPropertyValue("--wp-photo")).toBe(a);
    expect(layer()).toBe(0);
    // Converted: still the old picture until the new one has loaded.
    home.render(withPhoto(bPhoto));
    expect(homeEl().style.getPropertyValue("--wp-photo")).toBe(a);
    loaded();
    expect(homeEl().style.getPropertyValue("--wp-photo")).toContain("bbbbbbbbbbbb");
    expect(homeEl().style.getPropertyValue("--wp-dim")).toBe("0.6");
    expect(cls(homeEl()).includes("photo")).toBe(true);
    expect(layer()).toBe(1);
  });

  test("layers: photo, dim and blur sit over the drift and under the scrim, clock and tiles; ambient keeps them", () => {
    home.render(withPhoto({ kind: "mac" }, { ambient: true }));
    const order = Array.from(homeEl().children).map((c) => c.className.split(" ")[0]);
    const at = (c: string) => order.indexOf(c);
    expect(at("h-photo")).toBeGreaterThan(at("h-drift"));
    for (const above of ["h-scrim", "h-clock", "h-hero", "h-chrome"])
      expect(at("h-photo"), above).toBeLessThan(at(above));
    const photoLayer = homeEl().querySelector(".h-photo")!;
    for (const part of [
      ".h-photo-img",
      ".h-photo-dim",
      ".h-photo-blur.top",
      ".h-photo-blur.bottom",
    ])
      expect(photoLayer.querySelector(part), part).not.toBeNull();
    expect(homeEl().querySelector(".h-scrim")).not.toBeNull();
  });

  test("the stylesheet: dim comes from --wp-dim, a blur sits behind the clock and the tiles, and the drift is 1.0 to 1.06 over 120 s", () => {
    home.render(withPhoto({ kind: "mac" }));
    expect(rule(".h-photo-dim")!.style.getPropertyValue("opacity")).toBe("var(--wp-dim, 0.5)");
    expect(rule(".h-photo-blur")!.style.getPropertyValue("backdrop-filter")).toContain("--blur-");
    expect(rule(".h-photo-blur.top")!.style.getPropertyValue("top")).toBe("0px");
    expect(rule(".h-photo-blur.bottom")!.style.getPropertyValue("bottom")).toBe("0px");
    expect(rule(".h-photo-img")!.style.getPropertyValue("animation")).toContain(
      "--duration-photo-pan",
    );
    const kenburns = Array.from(document.styleSheets)
      .flatMap((s) => Array.from(s.cssRules))
      .find((r) => (r as CSSKeyframesRule).name === "h-kenburns") as CSSKeyframesRule;
    const frames = Array.from(kenburns.cssRules) as CSSKeyframeRule[];
    expect(frames.map((f) => [f.keyText, f.style.getPropertyValue("transform")])).toEqual([
      ["0%", "scale(1)"],
      ["100%", "scale(var(--home-pan-scale))"],
    ]);
    expect(GLASS.metrics.home.panScale).toBe(1.06);
  });

  test("the photo layer is hidden for built-ins, and the drift for photos", () => {
    expect(rule(".h-photo")!.style.getPropertyValue("display")).toBe("none");
    expect(rule(".home.photo .h-photo")!.style.getPropertyValue("display")).toBe("block");
    expect(rule(".home.photo .h-drift")!.style.getPropertyValue("display")).toBe("none");
  });
});

describe("Settings → Home with the Mac's pictures", () => {
  const pictures: PictureTile[] = [
    {
      kind: "mac",
      label: "Same as Mac",
      url: "file:///u/wallpapers/aaaaaaaaaaaa.jpg",
      thumb: "file:///u/wallpapers/aaaaaaaaaaaa.thumb.jpg",
      dim: 0.4,
    },
    { kind: "folder", file: "b.jpg", label: "B" },
    { kind: "apple", file: "Mac Blue.heic", label: "Mac Blue", thumb: "file:///u/t.jpg", dim: 0.5 },
  ];
  const page = (focusedId: string, wallpaper: NonNullable<ScreenPayload["home"]>["wallpaper"]) =>
    payload({
      view: "settingsHome",
      focusedId,
      home: {
        wallpaper,
        artwork: true,
        pictures,
        folder: "~/Pictures/Wallpapers",
        slideshow: "hour",
      },
    });

  test("the tiles follow the built-ins in order, with thumbnails once converted, and the saved one is In use", () => {
    settingsHome.render(page("pic:folder:b.jpg", { kind: "folder", file: "b.jpg" }));
    const tiles = Array.from(screen.querySelectorAll(".wp-tile")) as HTMLElement[];
    expect(tiles.map((t) => t.querySelector(".wp-name")!.textContent)).toEqual([
      ...WALLPAPERS.map((w) => w.label),
      "Same as Mac",
      "B",
      "Mac Blue",
    ]);
    expect(tiles.map((t) => t.getAttribute("data-id")).slice(6)).toEqual([
      "pic:mac",
      "pic:folder:b.jpg",
      "pic:apple:Mac Blue.heic",
    ]);
    expect(tiles[6]!.querySelector<HTMLElement>(".wp-swatch")!.style.backgroundImage).toContain(
      "aaaaaaaaaaaa.thumb.jpg",
    );
    expect(tiles[7]!.querySelector<HTMLElement>(".wp-swatch")!.style.backgroundImage).toBe("");
    const chosen = tiles.filter((t) => t.className.split(" ").includes("chosen"));
    expect(chosen.map((t) => t.getAttribute("data-id"))).toEqual(["pic:folder:b.jpg"]);
    expect(tiles[7]!.className.split(" ")).toContain("focused");
  });

  test("a file name is shown as text, never as markup", () => {
    const evil: PictureTile[] = [{ kind: "folder", file: "x.jpg", label: "<img src=x onerror=1>" }];
    settingsHome.render(
      payload({
        view: "settingsHome",
        focusedId: "wp:couch",
        home: { wallpaper: { kind: "builtin", id: "couch" }, artwork: true, pictures: evil },
      }),
    );
    expect(screen.querySelector(".wp-tile img")).toBeNull();
  });

  test("the folder and slideshow rows show their values", () => {
    settingsHome.render(page("folder", { kind: "builtin", id: "couch" }));
    const rows = Array.from(screen.querySelectorAll(".wp-panel .g-row")).map((r) => r.textContent);
    expect(rows).toEqual([
      "Show artwork behind ResumeOn",
      "Wallpaper folder~/Pictures/Wallpapers",
      "SlideshowEvery hour",
    ]);
  });

  test("a built-in saved marks only that built-in", () => {
    settingsHome.render(page("pic:mac", { kind: "builtin", id: "couch" }));
    const chosen = Array.from(screen.querySelectorAll(".wp-tile.chosen")).map(
      (t) => t.querySelector(".wp-name")!.textContent,
    );
    expect(chosen).toEqual(["Couch"]);
  });
});

describe("Home's Continue watching for an App title", () => {
  const title = (fromStart: boolean): LibraryEntry =>
    ({
      path: "app:netflix:https://www.netflix.com/watch/1",
      title: "Arcane",
      hue: 10,
      thumb: "https://occ-0-1.1.nflximg.net/a.jpg",
      folder: "Netflix",
      progress: { fraction: 0.2, left: "40 min left" },
      app: { id: "netflix", label: "Netflix", icon: "<svg>n</svg>", fromStart },
    }) as LibraryEntry;
  const tile = () =>
    screen.querySelector('[data-id="app:netflix:https://www.netflix.com/watch/1"]')!;

  test("its tile carries the App's badge next to the art and progress", () => {
    home.render(payload({ homeVideos: [title(false)] }));
    expect(tile().querySelector(".h-badge")?.innerHTML).toBe("<svg>n</svg>");
    expect(tile().querySelector(".h-prog")).not.toBeNull();
    expect(screen.querySelector(".h-film-art")).not.toBeNull();
  });

  test("a Library video's tile has no badge", () => {
    home.render(payload());
    expect(screen.querySelector(".h-badge")).toBeNull();
  });

  test("the hero offers From start only when the App's address carries the time", () => {
    home.render(payload({ homeVideos: [title(true)], hero: title(true) }));
    expect(screen.querySelector('[data-id="fromstart"]')).not.toBeNull();
    home.render(payload({ homeVideos: [title(false)], hero: title(false) }));
    expect(screen.querySelector('[data-id="resume"]')).not.toBeNull();
    expect(screen.querySelector('[data-id="fromstart"]')).toBeNull();
  });
});
