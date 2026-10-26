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
  isDrawer = false;
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
  const glassCalls: string[] = [];
  let bounds = { width: 1920, height: 1080 };
  const host: DrawerHost<FakeView> = {
    contentView: {
      children,
      addChildView: (v) => {
        if (glass && v instanceof FakeView && v.isDrawer) glassCalls.push("add");
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
        children.push(v);
      },
      removeChildView: (v) => {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
      },
    },
    getContentBounds: () => bounds,
  };
  const clock = new FakeClock();
  const commands: unknown[] = [];
  const closed: string[] = [];
  const view = new FakeView();
  view.isDrawer = true;
  const drawer = new QuickDrawer<FakeView>(
    host,
    () => view,
    (c) => commands.push(c),
    clock,
    () => closed.push("closed"),
    glass
      ? {
          beginRegistration: () => glassCalls.push("begin"),
          endRegistration: () => glassCalls.push("end"),
          open: (rect, ms) => glassCalls.push(`open ${JSON.stringify(rect)} ${ms}`),
          hide: () => glassCalls.push("hide"),
          close: (ms) => glassCalls.push(`close ${ms}`),
        }
      : undefined,
  );
  const appView = new FakeView();
  children.push(appView);
  return {
    children,
    drawer,
    view,
    appView,
    commands,
    clock,
    closed,
    glassCalls,
    resize: (width: number, height: number) => {
      bounds = { width, height };
      drawer.fit();
    },
  };
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
    const rectFor = (w: number, h: number) => JSON.stringify(drawerGlassRect(w, h));
    const rect = rectFor(1920, 1080);
    const S = QUICK_SLIDE_MS;

    test("registers the drawer's view around the one add, and not when it is only lifted back", () => {
      const { drawer, children, glassCalls } = setup(true);
      drawer.set(quick());
      expect(glassCalls).toEqual(["begin", "add", "end"]);
      children.push(new FakeView());
      drawer.set(quick("settings"));
      expect(glassCalls).toEqual(["begin", "add", "end", "add"]);
    });

    test("no glass before the page reports slideStart, however late it loads", () => {
      const { drawer, view, glassCalls, clock } = setup(true);
      drawer.set(quick());
      clock.advance(5000);
      drawer.set(quick("settings"));
      view.loaded!();
      expect(glassCalls.some((c) => c.startsWith("open"))).toBe(false);
      drawer.slideStart("in");
      expect(glassCalls.filter((c) => c.startsWith("open"))).toEqual([`open ${rect} ${S}`]);
    });

    test("a slideStart in after the drawer was already closed is ignored", () => {
      const { drawer, glassCalls } = setup(true);
      drawer.set(quick());
      drawer.set(undefined);
      drawer.slideStart("in");
      expect(glassCalls.some((c) => c.startsWith("open"))).toBe(false);
    });

    test("slides out only when the page reports it, and is removed for good when the slide ends", () => {
      const { drawer, glassCalls, clock } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      drawer.set(undefined);
      expect(glassCalls.some((c) => c === `close ${S}`)).toBe(false);
      drawer.slideStart("out");
      expect(glassCalls.at(-1)).toBe(`close ${S}`);
      clock.advance(S + 10);
      expect(glassCalls.at(-1)).toBe("close 0");
    });

    test("closed before the page ever slid: nothing to animate, and still removed at the end", () => {
      const { drawer, glassCalls, clock, children } = setup(true);
      drawer.set(quick());
      drawer.set(undefined);
      drawer.slideStart("out");
      clock.advance(S + 10);
      expect(glassCalls.filter((c) => c.startsWith("close"))).toEqual(["close 0"]);
      expect(children).toHaveLength(1);
    });

    test("closing mid-slide-in slides out from there and ends with the glass removed", () => {
      const { drawer, glassCalls, clock } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      clock.advance(S / 2);
      drawer.set(undefined);
      drawer.slideStart("out");
      clock.advance(S + 10);
      expect(glassCalls.filter((c) => c.startsWith("open") || c.startsWith("close"))).toEqual([
        `open ${rect} ${S}`,
        `close ${S}`,
        "close 0",
      ]);
    });

    test("a slide-out report that arrives after reopening is stale and ignored", () => {
      const { drawer, glassCalls } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      drawer.set(undefined);
      drawer.set(quick());
      drawer.slideStart("out");
      expect(glassCalls.some((c) => c === `close ${S}`)).toBe(false);
    });

    test("rapid reopening slides back in once, and the old removal never fires", () => {
      const { drawer, glassCalls, clock, children, view } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      drawer.set(undefined);
      drawer.slideStart("out");
      clock.advance(S / 2);
      drawer.set(quick());
      drawer.slideStart("in");
      clock.advance(S * 2);
      expect(glassCalls.filter((c) => c.startsWith("open") || c.startsWith("close"))).toEqual([
        `open ${rect} ${S}`,
        `close ${S}`,
        `open ${rect} ${S}`,
      ]);
      expect(children).toContain(view);
    });

    test("a resize while sliding in hides the glass and shows it at the final rectangle when the slide ends", () => {
      const { drawer, glassCalls, clock, resize } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      clock.advance(S / 2);
      resize(1000, 600);
      expect(glassCalls.at(-1)).toBe("hide");
      clock.advance(S);
      expect(glassCalls.at(-1)).toBe(`open ${rectFor(1000, 600)} 0`);
      expect(glassCalls.filter((c) => c.startsWith("open"))).toEqual([
        `open ${rect} ${S}`,
        `open ${rectFor(1000, 600)} 0`,
      ]);
    });

    test("a resize while sliding out hides the glass and it is never shown again", () => {
      const { drawer, glassCalls, clock, resize } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      clock.advance(S + 10);
      drawer.set(undefined);
      drawer.slideStart("out");
      clock.advance(S / 2);
      resize(1000, 600);
      expect(glassCalls.at(-1)).toBe("hide");
      clock.advance(S);
      expect(glassCalls.filter((c) => c.startsWith("open"))).toEqual([`open ${rect} ${S}`]);
      expect(glassCalls.at(-1)).toBe("close 0");
    });

    test("a resize before the page has started sliding changes nothing; after the slide it follows at once", () => {
      const { drawer, glassCalls, clock, resize } = setup(true);
      resize(1280, 720);
      expect(glassCalls).toEqual([]);
      drawer.set(quick());
      resize(1000, 600);
      expect(glassCalls.some((c) => c === "hide" || c.startsWith("open"))).toBe(false);
      drawer.slideStart("in");
      clock.advance(S + 10);
      resize(1920, 1080);
      expect(glassCalls.at(-1)).toBe(`open ${rect} 0`);
    });

    test("every open gets the rectangle and radius of the window it opens in", () => {
      const { drawer, glassCalls, clock, resize } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      clock.advance(S + 10);
      drawer.set(undefined);
      drawer.slideStart("out");
      clock.advance(S + 10);
      resize(1000, 600);
      drawer.set(quick());
      drawer.slideStart("in");
      const opens = glassCalls.filter((c) => c.startsWith("open"));
      expect(opens).toEqual([
        `open ${rectFor(1920, 1080)} ${S}`,
        `open ${rectFor(1000, 600)} ${S}`,
      ]);
      expect(drawerGlassRect(1920, 1080).r).not.toBe(drawerGlassRect(1000, 600).r);
    });

    test("teardown removes everything at once and no timer fires afterwards", () => {
      const { drawer, glassCalls, clock, children, appView, closed } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      drawer.teardown();
      expect(glassCalls.at(-1)).toBe("close 0");
      expect(children).toEqual([appView]);
      const before = [...glassCalls];
      clock.advance(S * 4);
      expect(glassCalls).toEqual(before);
      expect(closed).toEqual([]);
      expect(drawer.intercept({ preventDefault() {} }, { type: "keyDown", key: "ArrowDown" })).toBe(
        false,
      );
    });

    test("teardown mid-close cancels the pending removal timer and is safe twice", () => {
      const { drawer, glassCalls, clock, closed } = setup(true);
      drawer.set(quick());
      drawer.slideStart("in");
      drawer.set(undefined);
      drawer.teardown();
      drawer.teardown();
      clock.advance(S * 4);
      expect(glassCalls.filter((c) => c === "close 0")).toHaveLength(2);
      expect(closed).toEqual([]);
    });

    test("it can open again after a teardown", () => {
      const { drawer, glassCalls, children, view } = setup(true);
      drawer.set(quick());
      drawer.teardown();
      drawer.set(quick());
      drawer.slideStart("in");
      expect(children).toContain(view);
      expect(glassCalls.filter((c) => c === "begin")).toHaveLength(2);
      expect(glassCalls.at(-1)).toBe(`open ${rect} ${S}`);
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
