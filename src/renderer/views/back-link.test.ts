// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { ScreenPayload, View } from "../../shared/protocol.ts";

type Views = typeof import("./index.ts").VIEWS;
let views: Views;
let screen: HTMLElement;
const send = vi.fn();

beforeAll(async () => {
  document.body.innerHTML = '<div id="screen"></div>';
  views = (await import("./index.ts")).VIEWS;
  screen = document.getElementById("screen")!;
});
beforeEach(() => {
  screen.replaceChildren();
  (window as unknown as { couch: object }).couch = { send };
});
afterEach(() => send.mockClear());

function payload(view: View, extra: object = {}): ScreenPayload {
  const grid = views[view]?.grid ?? [{ id: "x", label: "X", r: 0, c: 0 }];
  return {
    state: { view, remotes: 0 },
    focusedId: grid[0]?.id,
    grid,
    now: 0,
    pairingUrl: "http://x",
    ...extra,
  } as unknown as ScreenPayload;
}

const pages: [View, string][] = [
  ["settings", "‹ Home"],
  ["settingsRemotes", "‹ Settings"],
  ["settingsLibrary", "‹ Settings"],
  ["settingsApps", "‹ Settings"],
  ["soundOutput", "‹ Settings"],
  ["settingsHome", "‹ Settings"],
  ["addons", "‹ YouTube"],
  ["appError", "‹ Home"],
  ["addPhone", "‹ Remotes and Devices"],
  ["libraryFolders", "‹ Library"],
  ["details", "‹ Library"],
  ["credits", "‹ Show and film details"],
];

describe("Settings back link", () => {
  test.each(pages)(
    "%s draws its back link, which sends back and is not a grid item",
    (view, label) => {
      views[view]!.render(payload(view));
      const links = screen.querySelectorAll<HTMLElement>(".g-back");
      expect(links.length).toBe(1);
      expect(links[0]!.textContent).toBe(label);
      expect(links[0]!.dataset.id).toBeUndefined();
      expect(links[0]!.getAttribute("aria-label")).toBe(`Back to ${label.slice(2)}`);
      links[0]!.click();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ command: "back" });
    },
  );

  test("sits above the page title", () => {
    views.settings!.render(payload("settings"));
    const link = screen.querySelector(".g-back")!;
    const title = screen.querySelector("h1")!;
    expect(link.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("under the Apps menu the link does nothing", () => {
    views.settingsApps!.render(
      payload("settingsApps", {
        homeApps: [{ id: "youtube", label: "YouTube" }],
        appMenu: { id: "youtube", label: "YouTube" },
      }),
    );
    screen.querySelector<HTMLElement>(".g-back")!.click();
    expect(send).not.toHaveBeenCalled();
  });
});

const entry = { title: "A", path: "/a", kind: "folder", hue: 1 };
const library = {
  heading: "Library",
  entries: [entry],
  rows: [{ id: "r", title: "R", entries: [] }],
};
const show = {
  id: "s",
  name: "Severance",
  meta: [],
  primary: "Play",
  tabs: [],
  episodes: [],
  artExpected: false,
};

interface Case {
  name: string;
  view: View;
  extra: object;
}
const browsing: Case[] = [
  { name: "Library", view: "library", extra: { viewKey: "library", library } },
  {
    name: "a library folder",
    view: "folder",
    extra: { viewKey: "folder:/m/a", library: { ...library, rows: undefined } },
  },
  { name: "a show", view: "show", extra: { show } },
  {
    name: "Fix match",
    view: "fixMatch",
    extra: { fixMatch: { name: "Severance", loading: false, options: [] } },
  },
  {
    name: "Library search",
    view: "librarySearch",
    extra: { search: { query: "", searching: false, typing: false, rows: [] } },
  },
];

// A label no page could guess: it can only come from payload.back.
const LABEL = "Wherever Back goes";

describe("Library back links", () => {
  test.each(browsing)("$name: the core's label, name, one back, not a grid item", (c) => {
    views[c.view]!.render(payload(c.view, { ...c.extra, back: { label: LABEL } }));
    const links = screen.querySelectorAll<HTMLElement>(".g-back");
    expect(links.length).toBe(1);
    expect(links[0]!.textContent).toBe(`‹ ${LABEL}`);
    expect(links[0]!.getAttribute("aria-label")).toBe(`Back to ${LABEL}`);
    expect(links[0]!.dataset.id).toBeUndefined();
    links[0]!.click();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ command: "back" });
  });

  test.each(browsing)("$name: no link when the core names no Back", (c) => {
    views[c.view]!.render(payload(c.view, c.extra));
    expect(screen.querySelector(".g-back")).toBeNull();
  });

  test("Library search while typing shows the core's Stop typing, in the same place", () => {
    const extra = { search: { query: "", searching: false, typing: true, rows: [] } };
    views.librarySearch!.render(
      payload("librarySearch", { ...extra, back: { label: "Stop typing" } }),
    );
    expect(screen.querySelector(".g-back")!.textContent).toBe("‹ Stop typing");
    expect(screen.querySelector(".g-back")!.classList.contains("corner")).toBe(true);
  });

  const overlays: [string, object][] = [
    ["a confirmation", { confirm: { title: "Sure?", options: ["Yes"], index: 0 } }],
    ["Picture off", { pictureOff: true }],
  ];
  const covers: [string, (c: Case) => object][] = [
    ...overlays.map(([n, state]): [string, (c: Case) => object] => [
      n,
      (c) => ({ state: { view: c.view, remotes: 0, ...state } }),
    ]),
    [
      "Quick settings",
      () => ({
        quick: { items: [], focusedId: "", volume: 0.5, muted: false },
      }),
    ],
    ["the Apps menu", () => ({ appMenu: { id: "youtube", label: "YouTube" } })],
  ];
  describe.each(covers)("under %s", (_name, cover) => {
    test.each(browsing)("$name: the link is disabled and silent", (c) => {
      views[c.view]!.render(payload(c.view, { ...c.extra, back: { label: LABEL }, ...cover(c) }));
      const link = screen.querySelector<HTMLButtonElement>(".g-back")!;
      expect(link.disabled).toBe(true);
      link.click();
      expect(send).not.toHaveBeenCalled();
    });
  });

  test("a Settings page's link does nothing while Quick settings or a question covers it", async () => {
    const { showing } = await import("./glass.ts");
    for (const extra of [
      { quick: { items: [] } },
      { state: { view: "settings", remotes: 0, confirm: { title: "Quit Couch?" } } },
    ]) {
      const p = payload("settings", extra);
      showing(p);
      views.settings!.render(p);
      screen.querySelector<HTMLElement>(".g-back")!.click();
      expect(send).not.toHaveBeenCalled();
    }
    showing(payload("settings"));
  });
});
