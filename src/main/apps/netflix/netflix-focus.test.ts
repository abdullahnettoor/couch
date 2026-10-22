import { describe, expect, test } from "vite-plus/test";
import { pageFocusFunction } from "../../web/page-focus.ts";
import { runFocusScript } from "../../web/page-focus-runner.ts";
import {
  loadSnapshot,
  snapshotPage,
  type FakeEl,
  type SnapNode,
  type Snapshot,
} from "../../web/snapshot-page.ts";
import { netflixDescription } from "./netflix-web.ts";

const fixture = (name: string) => loadSnapshot(new URL(`./fixtures/${name}.json`, import.meta.url));
const desc = netflixDescription("130.0.6723.58");

/** The page focus script as the Netflix App runs it, on a recorded page; keys go through the page's own listeners. */
function open(snap: Snapshot, focus = desc.focus!) {
  const page = snapshotPage(snap);
  const run = runFocusScript(pageFocusFunction(focus.selectors, focus.layout), {
    document: page.doc,
    href: snap.url,
    width: snap.view.width,
    height: snap.view.height,
    getComputedStyle: (e: FakeEl) => ({
      visibility: e.hiddenStyle ? "hidden" : "visible",
      display: "block",
      zIndex: "auto",
      position: e.stuck ? "fixed" : "static",
    }),
  });
  const { key, ring } = run;
  /** OK: the element that was clicked, if any. */
  const ok = (): FakeEl | undefined => {
    const before = new Map(page.all.map((e) => [e, e.clicks]));
    key("Enter");
    return page.all.find((e) => e.clicks > before.get(e)!);
  };
  /** The element the ring is on (OK clicks it; the click is undone). */
  const on = (): FakeEl | undefined => {
    const el = ok();
    if (el) el.clicks--;
    return el;
  };
  const press = (...keys: string[]) => keys.forEach(key);
  return { ...page, key, ok, on, press, ring };
}

const uia = (e: FakeEl | undefined) => e?.uia || e?.tagName || "(none)";

/** Whatever the ring sits on is visible, not a helper, and not most of the screen. */
function expectSane(e: FakeEl | undefined, snap: Snapshot) {
  expect(e).toBeDefined();
  expect(e!.hiddenStyle).toBe(false);
  expect(e!.getAttribute("tabindex")).not.toBe("-1");
  const r = e!.getBoundingClientRect();
  expect(r.width * r.height).toBeLessThanOrEqual(0.5 * snap.view.width * snap.view.height);
}

describe("browse", () => {
  const snap = fixture("browse");
  test("the ring starts on a visible control, never a hidden menu item", () => {
    const p = open(snap);
    expect(p.ring.style.display).toBe("block");
    expectSane(p.on(), snap);
  });
  test("the highlight is an outline with no fill", () => {
    expect(open(snap).ring.style.background).toBe("none");
  });
  const toFirstRow = (p: ReturnType<typeof open>) => {
    // From wherever the ring starts: down to the billboard's buttons, left to Play.
    const until = (k: string, re: RegExp) => {
      for (let i = 0; i < 6 && !re.test(uia(p.on())); i++) p.key(k);
    };
    until("ArrowDown", /^(play-video-button|billboard-more-info)$/);
    until("ArrowLeft", /^play-video-button$/);
    expect(p.on()!.uia).toBe("play-video-button");
    p.key("ArrowDown");
  };
  const rowOf = (e?: FakeEl) => e!.closest('[data-uia^="carousel-row-section"]')?.uia;
  test("Down from the billboard reaches the first row; Left/Right walk along it", () => {
    const p = open(snap);
    toFirstRow(p);
    const card = p.on()!;
    expect(card.uia).toMatch(/-card$/);
    expect(rowOf(card)).toBe("carousel-row-section-1");
    p.key("ArrowRight");
    const next = p.on()!;
    expect(next).not.toBe(card);
    expect(rowOf(next)).toBe("carousel-row-section-1");
    expect(next.rect.left).toBeGreaterThan(card.rect.left);
    expect(next.rect.top).toBe(card.rect.top);
    p.key("ArrowLeft");
    expect(p.on()).toBe(card);
  });
  test("Left/Right never leave their row; Up/Down move between rows", () => {
    const p = open(snap);
    toFirstRow(p);
    const first = rowOf(p.on());
    for (let i = 0; i < 12; i++) {
      p.key("ArrowRight");
      expect(rowOf(p.on())).toBe(first);
    }
    p.key("ArrowDown");
    expect(rowOf(p.on())).toBe("carousel-row-section-2");
    p.key("ArrowDown");
    expect(rowOf(p.on())).toBe("carousel-row-section-3");
    p.key("ArrowUp");
    expect(rowOf(p.on())).toBe("carousel-row-section-2");
  });
  test("moving between rows keeps roughly the same column", () => {
    const p = open(snap);
    toFirstRow(p);
    p.press("ArrowRight", "ArrowRight");
    const col = p.on()!.rect.left;
    p.key("ArrowDown");
    expect(Math.abs(p.on()!.rect.left - col)).toBeLessThanOrEqual(240);
  });
  test("past the last card on screen the row pages with its own Next button", () => {
    const p = open(snap);
    toFirstRow(p);
    const next = p.find("carousel-hawkins-right-button")[0]!;
    expect(next.clicks).toBe(0);
    for (let i = 0; i < 8; i++) p.key("ArrowRight");
    expect(next.clicks).toBeGreaterThan(0);
    expect(uia(p.on())).not.toMatch(/^carousel-hawkins/);
  });
  test("after the row pages, the ring lands on the first card of the new page", () => {
    const p = open(snap);
    toFirstRow(p);
    const row = p.find("carousel-row-section-1")[0]!;
    const cards = row.querySelectorAll('[data-uia$="-card"]');
    const next = p.find("carousel-hawkins-right-button")[0]!;
    // Netflix slides the row a page to the left when its Next button is pressed.
    next.click = () => {
      next.clicks++;
      for (const c of cards) {
        for (const e of [c, c.parent!]) {
          e.rect.left -= 1190;
          e.rect.right -= 1190;
        }
        // Netflix makes the cards now on screen focusable.
        c.attrs.tabindex = c.rect.left >= 0 && c.rect.right <= 1280 ? "0" : "-1";
      }
    };
    for (let i = 0; i < 4; i++) p.key("ArrowRight");
    expect(next.clicks).toBe(0);
    p.key("ArrowRight");
    expect(next.clicks).toBe(1);
    const landed = p.on()!;
    const inView = cards.filter(
      (c) => c.rect.left >= 0 && c.rect.right <= 1280 && c.getAttribute("tabindex") !== "-1",
    );
    expect(landed).toBe(inView.sort((a, b) => a.rect.left - b.rect.left)[0]);
  });
  test("at the end of a row the Next button does nothing and the ring stays", () => {
    const p = open(snap);
    toFirstRow(p);
    for (let i = 0; i < 4; i++) p.key("ArrowRight");
    const last = p.on()!;
    p.key("ArrowRight");
    expect(p.on()).toBe(last);
  });
  test("Up from the first row reaches the top bar; Left/Right walk along it", () => {
    const p = open(snap);
    toFirstRow(p);
    for (let i = 0; i < 6; i++) p.key("ArrowUp");
    const bar = p.on()!;
    expect(bar.rect.top).toBeLessThan(80);
    // Up again from the bar goes nowhere, and does not scroll the page back up to reach the billboard.
    const y = p.scroll.y;
    p.key("ArrowUp");
    expect(p.on()).toBe(bar);
    expect(p.scroll.y).toBe(y);
    p.key("ArrowRight");
    expect(p.on()!.rect.top).toBeLessThan(80);
    expect(p.on()!.rect.left).toBeGreaterThan(bar.rect.left);
  });
  test("a long walk over the page never offers a hidden menu item (sign-out, switch profile)", () => {
    const p = open(snap);
    const dirs = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowDown"];
    for (let i = 0; i < 120; i++) {
      p.key(dirs[i % dirs.length]!);
      const e = p.on();
      expectSane(e, snap);
      expect(uia(e)).not.toMatch(/sign-out|switch-profile|account|transfer/);
    }
  });
});

describe("a title's details", () => {
  const snap = fixture("details");
  const inModal = (e: FakeEl | undefined) =>
    !!e && !!e.closest('[data-uia^="modal-motion-container"]');
  test("the ring starts inside the modal, on a control", () => {
    const p = open(snap);
    expect(p.ring.style.display).toBe("block");
    const e = p.on();
    expectSane(e, snap);
    expect(inModal(e)).toBe(true);
  });
  test("however the arrows wander, the ring never leaves the modal for the page underneath", () => {
    const p = open(snap);
    const dirs = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"];
    for (let i = 0; i < 120; i++) {
      p.key(dirs[(i * 7) % dirs.length]!);
      const e = p.on();
      expectSane(e, snap);
      expect(inModal(e)).toBe(true);
    }
  });
  test("Play, My List, rate and close are all reachable by arrows", () => {
    const p = open(snap);
    const seen = new Set<string>();
    // Straight runs in each direction, over and over: every control in the modal gets visited.
    for (let round = 0; round < 4; round++)
      for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])
        for (let i = 0; i < 8; i++) {
          p.key(k);
          seen.add(uia(p.on()));
        }
    for (const want of [
      "play-button",
      "add-to-my-list",
      "thumbs-rate-button",
      "previewModal-closebtn",
    ])
      expect([...seen]).toContain(want);
  });
  test("with the modal open, OK never presses anything on the page underneath", () => {
    const p = open(snap);
    for (let i = 0; i < 40; i++) {
      p.key(["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"][i % 4]!);
      p.ok();
    }
    expect(p.all.filter((e) => e.clicks > 0 && !inModal(e))).toEqual([]);
  });
});

describe("the profile picker", () => {
  const snap = fixture("profiles");
  test("Left/Right walk the tiles and Down reaches Manage Profiles", () => {
    const p = open(snap);
    const tiles = p.all.filter((e) => /^profile-selector\+tile-P\d$/.test(e.uia));
    expect(tiles).toHaveLength(5);
    const seen = new Set<FakeEl>();
    p.press("ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft");
    seen.add(p.on()!);
    for (let i = 0; i < 8; i++) {
      p.key("ArrowRight");
      seen.add(p.on()!);
    }
    for (const t of tiles) expect(seen.has(t)).toBe(true);
    p.key("ArrowDown");
    expect(p.on()!.uia).toBe("profile-gate-screen+manage");
    p.key("ArrowUp");
    expect(p.on()!.uia).toMatch(/^profile-selector\+tile-/);
  });
});

describe("the player", () => {
  const snap = fixture("player");
  test("no highlight, and every key goes to Netflix's own player", () => {
    const p = open(snap);
    expect(p.ring.style.display).not.toBe("block");
    for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "])
      expect(p.key(k).defaultPrevented).toBe(false);
    expect(p.all.filter((e) => e.clicks > 0)).toEqual([]);
    expect(p.ring.style.display).not.toBe("block");
  });
  test("the same page at another address is not the player: it gets the highlight", () => {
    const p = open({ ...snap, url: "https://www.netflix.com/browse" });
    expect(p.key("ArrowLeft").defaultPrevented).toBe(true);
  });
});

describe("a page Couch does not know", () => {
  const el = (
    t: string,
    r: [number, number, number, number],
    a?: Record<string, string>,
  ): SnapNode => ({ t, r, a });
  const login: Snapshot = {
    url: "https://www.netflix.com/login",
    view: { width: 1280, height: 720 },
    tree: {
      t: "body",
      r: [0, 0, 1280, 720],
      c: [
        el("input", [440, 200, 400, 50], { type: "text" }),
        el("input", [440, 280, 400, 50], { type: "password" }),
        el("button", [440, 360, 400, 50]),
        el("a", [540, 440, 200, 30], { href: "#" }),
      ],
    },
  };
  for (const [name, focus] of [
    ["with Netflix's layout", desc.focus!],
    ["with the generic highlight alone", { selectors: [] as string[] }],
  ] as const) {
    test(`the generic highlight works (${name})`, () => {
      const p = open(login, focus);
      expect(p.ring.style.display).toBe("block");
      // It starts on the control nearest the middle: the button.
      expect(p.on()!.tagName).toBe("BUTTON");
      p.key("ArrowDown");
      expect(p.on()!.tagName).toBe("A");
      p.press("ArrowUp", "ArrowUp");
      expect(p.on()!.getAttribute("type")).toBe("password");
    });
  }
});
