import { describe, expect, test } from "vite-plus/test";
import type { QuickPayload } from "../../shared/protocol.ts";
import { QUICK_SLIDE_MS, drawerGlassRect } from "../../shared/quick-settings-page.ts";
import { FakeClock } from "../ports/fakes.ts";
import { QuickDrawer, type DrawerHost, type DrawerView } from "./quick-drawer.ts";

type KeyHandler = (event: { preventDefault(): void }, input: { type: string; key: string }) => void;

class FakeView implements DrawerView {
  calls: string[] = [];
  bounds?: { x: number; y: number; width: number; height: number };
  url = "";
  sent: Array<QuickPayload | undefined> = [];
  keyHandler?: KeyHandler;
  loaded?: () => void;
  webContents = {
    loadURL: (url: string) => {
      this.url = url;
      return Promise.resolve();
    },
    send: (_channel: string, quick: QuickPayload | undefined) => this.sent.push(quick),
    on: (event: string, handler: never) => {
      if (event === "before-input-event") this.keyHandler = handler;
      else this.loaded = handler;
    },
  } as DrawerView["webContents"];
  setBounds(b: { x: number; y: number; width: number; height: number }) {
    this.bounds = b;
  }
  setBackgroundColor(color: string) {
    this.calls.push(`bg:${color}`);
  }
  setVisible(v: boolean) {
    this.calls.push(`visible:${v}`);
  }
}

const quick = (focusedId = "out:default"): QuickPayload => ({
  items: [{ id: "out:default", r: 0, c: 0, label: "System default", checked: true }],
  focusedId,
  volume: 60,
  muted: false,
});

function setup(glass = false) {
  const children: unknown[] = [];
  const host: DrawerHost<FakeView> = {
    contentView: {
      children,
      addChildView: (v) => {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
        children.push(v);
      },
      removeChildView: (v) => {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
      },
    },
    getContentBounds: () => ({ width: 1920, height: 1080 }),
  };
  const clock = new FakeClock();
  const commands: unknown[] = [];
  const closed: string[] = [];
  const view = new FakeView();
  const glassCalls: string[] = [];
  const drawer = new QuickDrawer<FakeView>(
    host,
    () => view,
    (c) => commands.push(c),
    clock,
    () => closed.push("closed"),
    glass
      ? {
          open: (rect, ms) => glassCalls.push(`open ${JSON.stringify(rect)} ${ms}`),
          close: (ms) => glassCalls.push(`close ${ms}`),
        }
      : undefined,
  );
  const appView = new FakeView();
  children.push(appView);
  return { children, drawer, view, appView, commands, clock, closed, glassCalls };
}

const event = () => {
  const e = { prevented: false, preventDefault: () => (e.prevented = true) };
  return e;
};

describe("the Quick settings view", () => {
  test("is added above a web App's view, covers the window, and never touches the App's view", () => {
    const { drawer, children, view, appView } = setup();
    drawer.set(quick());
    expect(children).toEqual([appView, view]);
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(view.calls).toContain("bg:#00000000");
    expect(appView.calls).toEqual([]);
  });

  test("a view added after it is lifted back on top the next time it draws", () => {
    const { drawer, children, view } = setup();
    drawer.set(quick());
    const late = new FakeView();
    children.push(late);
    drawer.set(quick("settings"));
    expect(children.at(-1)).toBe(view);
  });

  test("hands the page what to draw once it has loaded, and again on every change", () => {
    const { drawer, view } = setup();
    drawer.set(quick());
    expect(view.sent).toEqual([]);
    view.loaded!();
    expect(view.sent).toEqual([quick()]);
    drawer.set(quick("settings"));
    expect(view.sent.at(-1)?.focusedId).toBe("settings");
  });

  test("slides out, then leaves the window, and gives focus back", () => {
    const { drawer, children, view, appView, clock, closed } = setup();
    drawer.set(quick());
    view.loaded!();
    drawer.set(undefined);
    expect(view.sent.at(-1)).toBeUndefined();
    expect(children).toContain(view);
    clock.advance(QUICK_SLIDE_MS + 10);
    expect(children).toEqual([appView]);
    expect(closed).toEqual(["closed"]);
    expect(appView.calls).toEqual([]);
  });

  test("stays above a Picture off cover added while it slides out", () => {
    const { drawer, children, view } = setup();
    drawer.set(quick());
    drawer.set(undefined);
    children.push(new FakeView());
    drawer.set(undefined);
    expect(children.at(-1)).toBe(view);
  });

  test("opening again before it left keeps it", () => {
    const { drawer, children, view, clock } = setup();
    drawer.set(quick());
    drawer.set(undefined);
    drawer.set(quick());
    clock.advance(QUICK_SLIDE_MS + 10);
    expect(children).toContain(view);
  });

  test("while open, a physical key sent to the App's page is swallowed and goes to the core", () => {
    const { drawer, commands } = setup();
    expect(drawer.intercept(event(), { type: "keyDown", key: "ArrowDown" })).toBe(false);
    drawer.set(quick());
    const e = event();
    expect(drawer.intercept(e, { type: "keyDown", key: "ArrowDown" })).toBe(true);
    expect(e.prevented).toBe(true);
    expect(commands).toEqual([{ command: "down" }]);
    drawer.intercept(event(), { type: "keyUp", key: "ArrowDown" });
    expect(commands).toHaveLength(1);
  });

  test("a physical Space becomes the core's playpause and never reaches the App's page", () => {
    const { drawer, commands } = setup();
    drawer.set(quick());
    const down = event();
    expect(drawer.intercept(down, { type: "keyDown", key: " " })).toBe(true);
    expect(down.prevented).toBe(true);
    const up = event();
    expect(drawer.intercept(up, { type: "keyUp", key: " " })).toBe(true);
    expect(up.prevented).toBe(true);
    expect(commands).toEqual([{ command: "playpause" }]);
  });

  test("a key pressed in the drawer's own page goes the same way", () => {
    const { drawer, view, commands } = setup();
    drawer.set(quick());
    const e = event();
    view.keyHandler!(e, { type: "keyDown", key: "Escape" });
    expect(e.prevented).toBe(true);
    expect(commands).toEqual([{ command: "back" }]);
  });

  describe("native glass", () => {
    const rect = JSON.stringify(drawerGlassRect(1920, 1080));

    test("opens with the slide, once, after the drawer's view is on top", () => {
      const { drawer, glassCalls } = setup(true);
      drawer.set(quick());
      drawer.set(quick("settings"));
      expect(glassCalls).toEqual([`open ${rect} ${QUICK_SLIDE_MS}`]);
    });

    test("slides out with the drawer and is removed for good when the slide ends", () => {
      const { drawer, glassCalls, clock } = setup(true);
      drawer.set(quick());
      drawer.set(undefined);
      expect(glassCalls.slice(1)).toEqual([`close ${QUICK_SLIDE_MS}`]);
      clock.advance(QUICK_SLIDE_MS + 10);
      expect(glassCalls.slice(1)).toEqual([`close ${QUICK_SLIDE_MS}`, "close 0"]);
    });

    test("closing mid-slide-in still ends with the glass removed", () => {
      const { drawer, glassCalls, clock } = setup(true);
      drawer.set(quick());
      clock.advance(QUICK_SLIDE_MS / 2);
      drawer.set(undefined);
      clock.advance(QUICK_SLIDE_MS + 10);
      expect(glassCalls.at(-1)).toBe("close 0");
    });

    test("reopening before the slide ended slides back in and the old removal does not fire", () => {
      const { drawer, glassCalls, clock } = setup(true);
      drawer.set(quick());
      drawer.set(undefined);
      drawer.set(quick());
      clock.advance(QUICK_SLIDE_MS + 10);
      expect(glassCalls).toEqual([
        `open ${rect} ${QUICK_SLIDE_MS}`,
        `close ${QUICK_SLIDE_MS}`,
        `open ${rect} ${QUICK_SLIDE_MS}`,
      ]);
    });

    test("follows a resized window at once while open, and not while closed", () => {
      const { drawer, glassCalls } = setup(true);
      drawer.fit();
      expect(glassCalls).toEqual([]);
      drawer.set(quick());
      drawer.fit();
      expect(glassCalls.at(-1)).toBe(`open ${rect} 0`);
    });

    test("its page drops the tint only when glass is on", () => {
      const withGlass = setup(true);
      withGlass.drawer.set(quick());
      expect(decodeURIComponent(withGlass.view.url)).not.toContain("backdrop-filter");
      const without = setup();
      without.drawer.set(quick());
      expect(decodeURIComponent(without.view.url)).toContain("backdrop-filter");
      expect(without.glassCalls).toEqual([]);
    });
  });
});
