import { describe, expect, test } from "vite-plus/test";
import { type Snapshot, type SnapNode } from "../../web/snapshot-page.ts";
import { connect, netflixPage } from "./netflix-test-page.ts";

const card = (id: number, x: number, y: number): SnapNode => ({
  t: "a",
  a: { "data-uia": "standard-card", tabindex: "0", href: `/browse?jbv=${id}` },
  r: [x, y, 230, 129],
});
const row = (n: number, y: number): SnapNode => ({
  t: "section",
  a: { "data-uia": `carousel-row-section-${n}` },
  r: [0, y, 1280, 178],
  c: [0, 1, 2, 3, 4].map((i) => card(n * 10 + i, 48 + i * 238, y + 40)),
});
const popup = (kind: string, x: number, y: number): SnapNode => ({
  t: "div",
  a: {
    "data-uia": `modal-motion-container-${kind}`,
    role: kind === "DETAIL_MODAL" ? "dialog" : "",
    tabindex: "-1",
  },
  r: [x, y, 340, 300],
  z: 5,
  c: [
    {
      t: "a",
      a: { "data-uia": "play-button", tabindex: "0", href: "#" },
      r: [x + 20, y + 200, 118, 45],
    },
  ],
});

/** Five rows (the page is 2000 px tall), Netflix's hover preview and its details pop-up, both closed. */
function setup() {
  const snap: Snapshot = {
    url: "https://www.netflix.com/browse",
    view: { width: 1280, height: 720 },
    tree: {
      t: "body",
      r: [0, 0, 1280, 2000],
      c: [
        row(1, 100),
        row(2, 400),
        row(3, 700),
        row(4, 1000),
        row(5, 1300),
        popup("MINI_MODAL", 270, 380),
        popup("DETAIL_MODAL", 215, 32),
      ],
    },
  };
  const p = netflixPage(snap, undefined, (page) => {
    connect(page.root.children[5]!, false);
    connect(page.root.children[6]!, false);
  });
  const mini = p.root.children[5]!;
  const details = p.root.children[6]!;
  const cardOf = (id: number) => p.all.find((e) => e.attrs.href === `/browse?jbv=${id}`)!;
  const trusted = { isTrusted: true };
  return { ...p, mini, details, cardOf, trusted };
}

describe("the mouse and the keys share one focus ring", () => {
  test("clicking a card, opening its details and closing them leaves the ring on that card", () => {
    const p = setup();
    p.key("ArrowRight");
    p.scroll.y = 600;
    p.fire("scroll", null, p.trusted);
    const clicked = p.cardOf(33);
    p.fire("click", clicked, p.trusted);
    connect(p.details, true);
    p.mutate();
    p.location.href = "https://www.netflix.com/browse?jbv=33";
    p.mutate();
    expect(p.on()?.uia).toBe("play-button");
    connect(p.details, false);
    p.location.href = "https://www.netflix.com/browse";
    p.mutate();
    expect(p.on()).toBe(clicked);
    expect(p.scroll.y).toBe(600);
  });

  test("a click the page sends itself (untrusted) does not move the ring", () => {
    const p = setup();
    p.key("ArrowRight");
    const held = p.on();
    p.fire("click", p.cardOf(33), {});
    expect(p.on()).toBe(held);
  });

  test("Netflix's hover preview appearing and leaving does not move the ring", () => {
    const p = setup();
    p.key("ArrowRight");
    const held = p.on();
    const y = p.scroll.y;
    connect(p.mini, true);
    p.mutate();
    expect(p.on()).toBe(held);
    connect(p.mini, false);
    p.mutate();
    expect(p.on()).toBe(held);
    expect(p.scroll.y).toBe(y);
  });

  test("the hover preview painted over the held card does not move the ring", () => {
    const p = setup();
    p.key("ArrowRight");
    const held = p.on()!;
    const r = held.rect!;
    p.mini.rect = {
      ...r,
      left: r.left - 20,
      top: r.top - 20,
      right: r.right + 20,
      bottom: r.bottom + 20,
    };
    connect(p.mini, true);
    p.mutate();
    expect(p.on()).toBe(held);
    p.mutate();
    expect(p.on()).toBe(held);
  });

  test("after a scroll leaves the ring off screen, an arrow moves from the cards on screen", () => {
    const p = setup();
    p.key("ArrowRight");
    p.scroll.y = 900;
    p.fire("scroll", null, p.trusted);
    p.key("ArrowDown");
    expect(p.on()?.attrs.href).toBe("/browse?jbv=52");
    expect(p.scroll.y).toBeGreaterThanOrEqual(900);
  });

  test("a scroll that keeps the ring on screen changes nothing", () => {
    const p = setup();
    p.key("ArrowRight");
    const held = p.on()!;
    p.scroll.y = 50;
    p.fire("scroll", null, p.trusted);
    p.key("ArrowRight");
    expect(p.on()).toBe(p.cardOf(Number(held.attrs.href!.slice(-2)) + 1));
  });
});
