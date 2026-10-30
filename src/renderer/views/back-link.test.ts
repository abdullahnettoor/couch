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
  ["addons", "‹ Apps"],
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
      links[0]!.click();
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
