import { describe, expect, test } from "vite-plus/test";
import { loadSnapshot, type FakeEl } from "../../web/snapshot-page.ts";
import { connect, netflixPage } from "../netflix/netflix-test-page.ts";
import { backAction, BACK_QUERY, type FocusLayout } from "../../web/page-focus.ts";
import { bitchordDescription } from "./bitchord-web.ts";

const desc = bitchordDescription("130.0.0.0", {
  request: () => Promise.reject(new Error("no network")),
  manifest: () => Promise.resolve("{}"),
});

/** BitChord's full view and menus, saved signed out with a song playing (`pnpm bitchord:snapshot`). */
const fixture = (name: string) => loadSnapshot(new URL(`./fixtures/${name}.json`, import.meta.url));

type Page = ReturnType<typeof netflixPage>;
const BAR = '[role="region"][aria-label="Player"]';
const label = (e?: FakeEl) => e?.getAttribute("aria-label") ?? "";
const isMore = (e?: FakeEl) => label(e).startsWith("More options");
const isItem = (e?: FakeEl) => (e?.getAttribute("role") ?? "").startsWith("menuitem");
const dialog = (p: Page) => p.all.find((e) => e.getAttribute("role") === "dialog")!;
const menuOf = (p: Page) => p.all.find((e) => e.getAttribute("role") === "menu")!;
/** A menu's backdrop: the page-sized box painted just under it. */
const backdropOf = (p: Page) =>
  menuOf(p).parent!.children.find((e) => e.getAttribute("aria-hidden") === "true")!;
const items = (p: Page) => menuOf(p).children.filter(isItem);

function open(name: string, prepare?: (p: Page) => void, focus = desc.focus!) {
  return netflixPage(fixture(name), focus, ((page: Page) => {
    // A z-index inside the full view only orders its own parts (a stacking context): the fake DOM paints by the nearest one up the tree, so they are lifted above the view itself.
    page.all.forEach((e) => {
      if (
        e.z !== undefined &&
        e.z > 0 &&
        e.closest("[role=dialog]") &&
        e.getAttribute("role") !== "dialog"
      )
        e.z = 9950;
    });
    prepare?.(page);
  }) as never);
}
const hide = (...els: FakeEl[]) => els.forEach((e) => connect(e, false));
const show = (...els: FakeEl[]) => els.forEach((e) => connect(e, true));
/** The household clicks a control: it is the one held, as when it was reached with the D-pad. */
const hold = (p: Page, el: FakeEl) => p.fire("click", el, { isTrusted: true });
const back = (p: Page) => backAction(p.run(BACK_QUERY));
/** A Down in BitChord's menu: it moves its own focus and prevents the key, before Couch's handler sees it. */
const bitchordMoves = (p: Page, to: FakeEl) =>
  p.key("ArrowDown", { defaultPrevented: true, later: () => p.fire("focusin", to) });

/** Every control the ring lands on over a fixed shuffle of keys. */
function reach(p: Page, steps = 400) {
  const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
  const stops = new Set<FakeEl>();
  let seed = 7;
  for (let i = 0; i < steps; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    p.key(keys[(seed >> 8) % 4]!);
    const e = p.on();
    if (e) stops.add(e);
  }
  // Down now ends in the bar, which Right then walks: the shuffle alone rarely stays there.
  const sweep = (key: string, n: number) => {
    for (let i = 0; i < n; i++) {
      p.key(key);
      const e = p.on();
      if (e) stops.add(e);
    }
  };
  sweep("ArrowDown", 60);
  sweep("ArrowRight", 15);
  return stops;
}

// A walk of the full view takes about 2 s here and more on a busy CI runner: walk it once for the tests that read it.
let fullViewStops: Set<FakeEl> | undefined;
const fullViewReach = () => (fullViewStops ??= reach(open("fullview")));
const WALK_MS = 30_000;

describe("BitChord's full view, from the Remote", () => {
  test("the ring starts on Pause, not on BitChord's own Close", () => {
    const p = open("fullview");
    expect(label(p.on())).toBe("Pause");
    expect(p.on()!.closest("section")?.getAttribute("aria-label")).toBe("Player");
  });

  test(
    "the controls, the Lyrics toggle, Up Next, Mute, ⋯ and Close can all be reached",
    () => {
      const stops = fullViewReach();
      const names = new Set([...stops].map(label));
      for (const want of [
        "Shuffle",
        "Previous",
        "Next",
        "Repeat",
        "Lyrics",
        "Up Next",
        "Mute",
        "Close",
      ])
        expect(names.has(want), want).toBe(true);
      expect([...stops].some(isMore)).toBe(true);
    },
    WALK_MS,
  );

  test(
    "the ring never lands on Enter full screen, the volume slider or a hover-only lyric button",
    () => {
      for (const e of fullViewReach()) {
        expect(label(e)).not.toBe("Enter full screen");
        expect(label(e)).not.toBe("Lyric settings");
        expect(e.getAttribute("type")).not.toBe("range");
        expect(e.closest('section[aria-label="Lyrics"]')).toBeNull();
      }
    },
    WALK_MS,
  );

  test(
    "the ring stays inside the full view",
    () => {
      for (const e of fullViewReach()) expect(e.closest("[role=dialog]")).toBeTruthy();
    },
    WALK_MS,
  );

  test("Back closes the full view, and the ring goes back to the bar's artwork", () => {
    const p = open("fullview", (page) => hide(dialog(page)));
    const art = p.all.find((e) => label(e) === "Open full screen player")!;
    hold(p, art);
    expect(p.on()).toBe(art);
    expect(back(p)).toBe("history");
    show(dialog(p));
    p.mutate();
    expect(label(p.on())).toBe("Pause");
    expect(back(p)).toBe("press");
    hide(dialog(p));
    p.mutate();
    expect(p.on()).toBe(art);
    expect(back(p)).toBe("history");
  });
});

describe("BitChord's ⋯ menus, from the Remote", () => {
  test(
    "the bar's ⋯ is a stop, and a song row's ⋯ is not",
    () => {
      const p = open("menu", (page) => hide(menuOf(page), backdropOf(page)));
      const stops = reach(p);
      const more = [...stops].filter(isMore);
      expect(more.length).toBeGreaterThan(0);
      for (const e of more) expect(e.closest(BAR)).toBeTruthy();
      expect(
        [...stops]
          .filter((e) => e.closest('[class*="group/track"]'))
          .every((e) => label(e).startsWith("Play ")),
      ).toBe(true);
    },
    WALK_MS,
  );

  test("a menu opens with the ring on its first item, and Down and Up walk it", () => {
    const p = open("menu");
    const [first, second] = items(p);
    expect(p.on()).toBe(first);
    p.key("ArrowDown");
    expect(p.on()).toBe(second);
    p.key("ArrowDown");
    expect(p.on()).toBe(second);
    p.key("ArrowUp");
    expect(p.on()).toBe(first);
    expect(p.ok()).toBe(first);
  });

  test(
    "the ring never leaves an open menu",
    () => {
      for (const e of reach(open("menu"), 120)) expect(e.closest("[role=menu]")).toBeTruthy();
    },
    WALK_MS,
  );

  test("the lyrics provider menu opens on the checked item and is walked from there", () => {
    const p = open("provider-menu");
    const all = items(p);
    const checked = all.find((e) => e.getAttribute("aria-checked") === "true")!;
    expect(checked).toBeDefined();
    expect(p.on()).toBe(checked);
    const at = all.indexOf(checked);
    p.key("ArrowDown");
    expect(p.on()).toBe(all[at + 1]);
    p.key("ArrowUp");
    expect(p.on()).toBe(checked);
  });

  test("Back closes the menu, the ring goes back to the ⋯ that opened it, and the page doesn't change", () => {
    const p = open("menu", (page) => hide(menuOf(page), backdropOf(page)));
    const more = p.all.find((e) => isMore(e) && e.closest(BAR))!;
    hold(p, more);
    expect(back(p)).toBe("history");
    show(menuOf(p), backdropOf(p));
    p.mutate();
    expect(p.on()).toBe(items(p)[0]);
    expect(back(p)).toBe("press");
    hide(menuOf(p), backdropOf(p));
    p.mutate();
    expect(p.on()).toBe(more);
    expect(p.location.href).toBe(fixture("menu").url);
  });

  test("in the full view: Back closes the menu first, then the view", () => {
    const p = open("fullview-menu", (page) => hide(dialog(page), menuOf(page), backdropOf(page)));
    const art = p.all.find((e) => label(e) === "Open full screen player")!;
    hold(p, art);
    show(dialog(p));
    p.mutate();
    expect(label(p.on())).toBe("Pause");
    const more = p.all.find((e) => isMore(e) && e.closest("[role=dialog]"))!;
    hold(p, more);
    expect(p.on()).toBe(more);
    show(menuOf(p), backdropOf(p));
    p.mutate();
    expect(p.on()).toBe(items(p)[0]);
    expect(back(p)).toBe("press");
    hide(menuOf(p), backdropOf(p));
    p.mutate();
    expect(p.on()).toBe(more);
    expect(back(p)).toBe("press");
    hide(dialog(p));
    p.mutate();
    expect(p.on()).toBe(art);
    expect(back(p)).toBe("history");
  });
});

describe("inside a menu the ring follows BitChord's own focus", () => {
  test("the ring goes where BitChord's focus goes, so OK presses the item under it", () => {
    const p = open("menu");
    const [first, second] = items(p);
    expect(p.on()).toBe(first);
    bitchordMoves(p, second!);
    expect(p.on()).toBe(second);
    expect(p.ok()).toBe(second);
  });

  test("the entry item takes the page's focus too, so BitChord's arrows go on from it", () => {
    const p = open("menu");
    // The fake counts a focus() as a press.
    expect(items(p)[0]!.clicks).toBe(1);
    expect(items(p)[1]!.clicks).toBe(0);
  });

  test("BitChord's own first focus when the menu opens doesn't take the ring off its entry", () => {
    const p = open("provider-menu");
    const all = items(p);
    const checked = all.find((e) => e.getAttribute("aria-checked") === "true")!;
    p.fire(
      "focusin",
      all.find((e) => e !== checked),
    );
    expect(p.on()).toBe(checked);
  });

  test("after a key of the household's, a move of BitChord's focus is followed", () => {
    const p = open("provider-menu");
    const all = items(p);
    const checked = all.find((e) => e.getAttribute("aria-checked") === "true")!;
    const next = all[all.indexOf(checked) + 1]!;
    bitchordMoves(p, next);
    expect(p.on()).toBe(next);
  });

  test("a focus outside the open menu is not followed", () => {
    const p = open("menu");
    const outside = p.all.find((e) => e.tagName === "A" && e.getAttribute("href") === "/home")!;
    p.fire("focusin", outside);
    expect(p.on()).toBe(items(p)[0]);
  });

  test("a layout that doesn't ask for it is unchanged: the ring stays where Couch put it", () => {
    const layout: FocusLayout = { ...desc.focus!.layout, followFocus: false };
    const p = open("menu", undefined, { ...desc.focus!, layout });
    const [first, second] = items(p);
    bitchordMoves(p, second!);
    expect(p.on()).toBe(first);
  });
});
