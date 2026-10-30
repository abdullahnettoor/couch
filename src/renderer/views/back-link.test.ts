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
  label: string;
  title?: string;
}
const browsing: Case[] = [
  { name: "Library", view: "library", extra: { viewKey: "library", library }, label: "Home" },
  {
    name: "a library folder",
    view: "folder",
    extra: { viewKey: "folder:/m/a", library: { ...library, rows: undefined } },
    label: "Library",
  },
  {
    name: "a subfolder",
    view: "folder",
    extra: { viewKey: "folder:/m/a/b", library: { ...library, rows: undefined, parent: "Shows" } },
    label: "Shows",
  },
  { name: "a show", view: "show", extra: { show }, label: "Library" },
  {
    name: "a show opened from search",
    view: "show",
    extra: { show: { ...show, backTo: "Search" } },
    label: "Search",
  },
  {
    name: "Fix match",
    view: "fixMatch",
    extra: { fixMatch: { name: "Severance", loading: false, options: [] } },
    label: "Severance",
  },
  {
    name: "Library search",
    view: "librarySearch",
    extra: { search: { query: "", searching: false, typing: false, rows: [] } },
    label: "Library",
  },
];

describe("Library back links", () => {
  test.each(browsing)("$name: label, name, one back, not a grid item", (c) => {
    views[c.view]!.render(payload(c.view, c.extra));
    const links = screen.querySelectorAll<HTMLElement>(".g-back");
    expect(links.length).toBe(1);
    expect(links[0]!.textContent).toBe(`‹ ${c.label}`);
    expect(links[0]!.getAttribute("aria-label")).toBe(`Back to ${c.label}`);
    expect(links[0]!.dataset.id).toBeUndefined();
    links[0]!.click();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ command: "back" });
  });

  test.each(browsing)("$name: disabled and silent under an overlay", (c) => {
    const confirm = { title: "Sure?", options: ["Yes"], index: 0 };
    views[c.view]!.render(
      payload(c.view, { ...c.extra, state: { view: c.view, remotes: 0, confirm } }),
    );
    const link = screen.querySelector<HTMLButtonElement>(".g-back")!;
    expect(link.disabled).toBe(true);
    link.click();
    expect(send).not.toHaveBeenCalled();
  });
});
