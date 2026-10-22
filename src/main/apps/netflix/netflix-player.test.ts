import { describe, expect, test } from "vite-plus/test";
import { backAction, pageFocusFunction } from "../../web/page-focus.ts";
import { runFocusScript } from "../../web/page-focus-runner.ts";
import {
  loadSnapshot,
  snapshotPage,
  type FakeEl,
  type SnapNode,
  type Snapshot,
} from "../../web/snapshot-page.ts";
import { netflixDescription } from "./netflix-web.ts";

const desc = netflixDescription("130.0.6723.58");
const player = loadSnapshot(new URL("./fixtures/player.json", import.meta.url));

const item = (name: string, left: number, top: number, on = false): SnapNode => ({
  t: "li",
  a: { "data-uia": on ? `${name.split("-")[0]}-item-selected-${name}` : `${name}`, tabindex: "0" },
  r: [left, top, 160, 43],
});
/** The audio and subtitle menu Netflix opens over the bar: two columns of items. */
const menu: SnapNode = {
  t: "div",
  a: { "data-uia": "selector-audio-subtitle", tabindex: "0" },
  r: [844, 237, 435, 373],
  c: [
    {
      ...item("audio-item-One", 851, 292, true),
      a: { "data-uia": "audio-item-One", tabindex: "0" },
    },
    { ...item("audio-item-Two", 851, 336), a: { "data-uia": "audio-item-Two", tabindex: "0" } },
    { ...item("audio-item-Three", 851, 379), a: { "data-uia": "audio-item-Three", tabindex: "0" } },
    { ...item("x", 1110, 292), a: { "data-uia": "subtitle-item-Off", tabindex: "0" } },
    { ...item("x", 1110, 336), a: { "data-uia": "subtitle-item-One", tabindex: "0" } },
    { ...item("x", 1110, 379), a: { "data-uia": "subtitle-item-Two", tabindex: "0" } },
  ],
};

const BAR = ["control-nav-back", "control-flag", "controls-standard"];

/**
 * The recorded player as Netflix draws it: the bar (and its menu) is not there until the page is
 * moved over by the pointer, as the real one; the test says when Netflix has drawn it.
 */
function open(url = player.url) {
  const snap: Snapshot = {
    ...player,
    url,
    tree: { ...player.tree, c: [...player.tree.c!, menu] },
  };
  const page = snapshotPage(snap);
  const bar = page.all.filter((e) => BAR.includes(e.uia));
  const menuEl = page.find("selector-audio-subtitle")[0]!;
  const set = (el: FakeEl, on: boolean) => {
    el.connected = on;
    el.children.forEach((c) => set(c, on));
  };
  bar.forEach((e) => set(e, false));
  set(menuEl, false);
  const run = runFocusScript(pageFocusFunction(desc.focus!.selectors, desc.focus!.layout), {
    document: page.doc,
    href: snap.url,
    width: snap.view.width,
    height: snap.view.height,
    getComputedStyle: (e: FakeEl) => ({
      visibility: e.hiddenStyle ? "hidden" : "visible",
      display: "block",
      zIndex: "auto",
      position: "static",
    }),
  });
  const moves = () => page.all.reduce((n, e) => n + e.events.length, 0);
  /** Netflix notices the pointer and draws its bar. */
  const draw = () => {
    bar.forEach((e) => set(e, true));
    run.mutate();
  };
  const sub = page.find("control-audio-subtitle")[0]!;
  sub.click = () => {
    sub.clicks++;
    set(menuEl, true);
    run.mutate();
  };
  const closeMenu = () => {
    set(menuEl, false);
    run.mutate();
  };
  const on = (): FakeEl | undefined => {
    const before = new Map(page.all.map((e) => [e, e.clicks]));
    const keep = sub.click;
    sub.click = () => sub.clicks++;
    run.key("Enter");
    sub.click = keep;
    const hit = page.all.find((e) => e.clicks > before.get(e)!);
    if (hit) hit.clicks--;
    return hit;
  };
  const back = () => run.run("window.__couchPlayerBack && window.__couchPlayerBack()");
  /** Down; Netflix draws the bar. */
  const bringUp = () => {
    run.key("ArrowDown");
    draw();
  };
  return { ...page, ...run, set, moves, draw, on, back, bringUp, closeMenu, menuEl, sub };
}

const uia = (e?: FakeEl) => e?.uia ?? "(none)";

describe("the bar hidden", () => {
  test("every key but Down stays Netflix's own: no highlight", () => {
    const p = open();
    for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "Enter", " "])
      expect(p.key(k).defaultPrevented).toBe(false);
    expect(p.ring.style.display).not.toBe("block");
    expect(p.moves()).toBe(0);
  });
  test("a page that is not the player has no bar mode", () => {
    const p = open("https://www.netflix.com/browse");
    expect(p.run("window.__couchPlayerBack && window.__couchPlayerBack()")).toBeFalsy();
  });
});

describe("Down reveals the bar", () => {
  test("it moves the pointer over the player the way Netflix expects, and the highlight lands on play/pause", () => {
    const p = open();
    const e = p.key("ArrowDown");
    expect(e.defaultPrevented).toBe(true);
    expect(p.moves()).toBeGreaterThan(0);
    p.draw();
    expect(p.ring.style.display).toBe("block");
    expect(uia(p.on())).toBe("control-play-pause-pause");
  });
  test("the highlight waits for the bar to be drawn", () => {
    const p = open();
    p.key("ArrowDown");
    expect(p.ring.style.display).not.toBe("block");
    p.draw();
    expect(p.ring.style.display).toBe("block");
  });
  test("Left/Right go along the bar, stopping at its ends; OK presses", () => {
    const p = open();
    p.bringUp();
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      seen.push(uia(p.on()));
      expect(p.key("ArrowRight").defaultPrevented).toBe(true);
    }
    expect(seen.slice(0, 5)).toEqual([
      "control-play-pause-pause",
      "control-back10",
      "control-forward10",
      "control-volume-high",
      "control-audio-subtitle",
    ]);
    expect(seen[8]).toBe("control-fullscreen-enter");
    p.key("ArrowLeft");
    expect(uia(p.on())).toBe("control-speed");
  });
  test("OK presses the control, not Netflix's own handler", () => {
    const p = open();
    p.bringUp();
    p.key("ArrowRight");
    const e = p.key("Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(p.find("control-back10")[0]!.clicks).toBe(1);
  });
  test("Up reaches the top controls, Down comes back", () => {
    const p = open();
    p.bringUp();
    p.key("ArrowUp");
    expect(["control-nav-back", "control-flag"]).toContain(uia(p.on()));
    p.key("ArrowDown");
    expect(uia(p.on())).toMatch(/^control-/);
    expect(p.on()!.getBoundingClientRect().top).toBeGreaterThan(500);
  });
  test("a control that Netflix swaps for another in place keeps the highlight at that spot", () => {
    const p = open();
    p.bringUp();
    const pause = p.find("control-play-pause-pause")[0]!;
    pause.connected = false;
    pause.attrs["data-uia"] = "control-play-pause-play";
    pause.connected = true;
    p.mutate();
    expect(uia(p.on())).toBe("control-play-pause-play");
  });
});

describe("the subtitles menu", () => {
  const toSubtitles = (p: ReturnType<typeof open>) => {
    p.bringUp();
    for (let i = 0; i < 6 && uia(p.on()) !== "control-audio-subtitle"; i++) p.key("ArrowRight");
    expect(uia(p.on())).toBe("control-audio-subtitle");
    p.key("Enter");
  };
  test("OK opens it, the highlight goes into it; Up/Down walk a column, Left/Right change column", () => {
    const p = open();
    toSubtitles(p);
    expect(p.sub.clicks).toBeGreaterThan(0);
    expect(uia(p.on())).toBe("audio-item-One");
    p.key("ArrowDown");
    expect(uia(p.on())).toBe("audio-item-Two");
    p.key("ArrowRight");
    expect(uia(p.on())).toBe("subtitle-item-One");
    p.key("ArrowUp");
    expect(uia(p.on())).toBe("subtitle-item-Off");
    p.key("ArrowUp");
    expect(uia(p.on())).toBe("subtitle-item-Off");
  });
  test("the bar is out of reach while the menu is open", () => {
    const p = open();
    toSubtitles(p);
    for (let i = 0; i < 5; i++) p.key("ArrowDown");
    expect(uia(p.on())).toBe("audio-item-Three");
  });
  test("OK on an item presses it", () => {
    const p = open();
    toSubtitles(p);
    p.key("ArrowRight");
    p.key("Enter");
    expect(p.find("subtitle-item-Off")[0]!.clicks).toBe(1);
  });
  test("when the menu closes the highlight is back on its control", () => {
    const p = open();
    toSubtitles(p);
    p.key("ArrowRight");
    p.closeMenu();
    expect(uia(p.on())).toBe("control-audio-subtitle");
  });
});

describe("Back with the bar up", () => {
  test("closes the menu (the page's own Escape), then hides the bar (Escape again, and Couch stops waking it), then leaves the player", () => {
    const p = open();
    p.bringUp();
    for (let i = 0; i < 6 && uia(p.on()) !== "control-audio-subtitle"; i++) p.key("ArrowRight");
    p.key("Enter");
    expect(p.back()).toBe("escape");
    p.closeMenu();
    expect(p.back()).toBe("escape");
    expect(p.ring.style.display).not.toBe("block");
    const n = p.moves();
    p.wait(3000);
    expect(p.moves()).toBe(n);
    expect(p.key("ArrowLeft").defaultPrevented).toBe(false);
    expect(p.key("Enter").defaultPrevented).toBe(false);
    expect(p.back()).toBeFalsy();
  });
  test("what the host does with each answer: the page's Escape, nothing, or history back", () => {
    expect(backAction("escape")).toBe("press");
    expect(backAction("handled")).toBe("none");
    expect(backAction("")).toBe("history");
    expect(backAction(undefined)).toBe("history");
    expect(backAction(false)).toBe("history");
  });
});

describe("keys the host sends for a skip", () => {
  test("pass through the bar to the player while the host says so, then the bar has the arrows again", () => {
    const p = open();
    p.bringUp();
    p.run("window.__couchRawKeys(5000)");
    expect(p.key("ArrowRight").defaultPrevented).toBe(false);
    p.run("window.__couchRawKeys(0)");
    expect(p.key("ArrowRight").defaultPrevented).toBe(true);
  });
});

describe("the bar goes away", () => {
  test("after a few idle seconds; a key keeps it up", () => {
    const p = open();
    p.bringUp();
    p.wait(4000);
    p.key("ArrowRight");
    p.wait(4000);
    expect(p.ring.style.display).toBe("block");
    p.wait(2000);
    expect(p.ring.style.display).not.toBe("block");
    expect(p.key("ArrowLeft").defaultPrevented).toBe(false);
  });
  test("while it is up Couch keeps Netflix's bar from hiding", () => {
    const p = open();
    p.bringUp();
    const n = p.moves();
    p.wait(3000);
    expect(p.moves()).toBeGreaterThan(n);
  });
  test("Down brings it back", () => {
    const p = open();
    p.bringUp();
    p.wait(10000);
    p.key("ArrowDown");
    p.draw();
    expect(p.ring.style.display).toBe("block");
  });
  test("leaving the player ends it", () => {
    const p = open();
    p.bringUp();
    p.location.href = "https://www.netflix.com/browse";
    p.mutate();
    expect(p.back()).toBeFalsy();
    const n = p.moves();
    p.wait(3000);
    expect(p.moves()).toBe(n);
  });
});
