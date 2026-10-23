import { describe, expect, test } from "vite-plus/test";
import { type FakeEl, type Snapshot, type SnapNode } from "../../web/snapshot-page.ts";
import { connect, netflixPage } from "./netflix-test-page.ts";

const card = (id: number, col: number, top: number): SnapNode => ({
  t: "div",
  a: { "data-virtual-slot": String(col) },
  r: [48 + col * 238, top, 230, 133],
  c: [
    {
      t: "a",
      a: { "data-uia": "standard-card", tabindex: "0", href: `/browse?jbv=${id}` },
      r: [48 + col * 238, top + 2, 230, 129],
    },
  ],
});
const row = (n: number, top: number, ids: number[]): SnapNode => ({
  t: "section",
  a: { "data-uia": `carousel-row-section-${n}` },
  r: [0, top, 1280, 178],
  c: [
    ...ids.map((id, i) => card(id, i, top + 40)),
    {
      t: "button",
      a: { "data-uia": "carousel-hawkins-right-button" },
      r: [1240, top + 40, 40, 133],
    },
    { t: "button", a: { "data-uia": "carousel-hawkins-left-button" }, r: [0, top + 40, 40, 133] },
  ],
});
const modal = (name: string, left: number, close: string): SnapNode => ({
  t: "div",
  a: { "data-uia": `modal-motion-container-${name}`, role: "dialog" },
  r: [left, 20, 500, 500],
  c: [
    {
      t: "span",
      a: { "data-uia": close, role: "button", tabindex: "0" },
      r: [left + 450, 30, 36, 20],
    },
    { t: "button", a: { "data-uia": `${name}-play` }, r: [left + 20, 400, 100, 40] },
  ],
});

/** Three rows of cards (ids 1xx, 2xx, 3xx), a spare replacement for row 2 (shifted by one title) and two spare pop-ups, all unmounted. */
function page() {
  const snap: Snapshot = {
    url: "https://www.netflix.com/browse",
    view: { width: 1280, height: 720 },
    tree: {
      t: "body",
      r: [0, 0, 1280, 1400],
      c: [
        row(1, 100, [101, 102, 103, 104]),
        row(2, 300, [200, 201, 202, 203]),
        row(2, 300, [201, 202, 203, 204]),
        row(3, 500, [301, 302, 303, 304]),
        modal("A", 100, "closeA"),
        modal("B", 400, "closeB"),
      ],
    },
  };
  const p = netflixPage(snap, undefined, (page) => {
    const [, r2b, , , mA, mB] = page.root.children;
    [r2b!, mA!, mB!].forEach((e) => connect(e, false));
  });
  const [r1, r2b, r2, r3, mA, mB] = p.root.children;
  const cardOf = (r: FakeEl, id: number) =>
    r.querySelectorAll("a").find((a) => a.getAttribute("href")!.includes(`jbv=${id}`))!;
  return {
    ...p,
    r1: r1!,
    r2: r2!,
    r3: r3!,
    r2b: r2b!,
    mA: mA!,
    mB: mB!,
    cardOf,
  };
}

/** Arrow keys until the ring is on `el` (bounded). */
function goTo(p: ReturnType<typeof page>, el: FakeEl) {
  const rowOf = (e: FakeEl) => e.closest('[data-uia^="carousel-row-section"]')!;
  for (let i = 0; i < 20 && p.on() !== el; i++) {
    const cur = p.on();
    if (!cur) return;
    if (rowOf(cur) !== rowOf(el)) {
      p.key(rowOf(cur).rect.top < rowOf(el).rect.top ? "ArrowDown" : "ArrowUp");
    } else p.key(cur.rect.left < el.rect.left ? "ArrowRight" : "ArrowLeft");
  }
  expect(p.on()).toBe(el);
}

describe("Back returns the highlight to the card you opened", () => {
  test("the card is still there: highlight returns to it", () => {
    const p = page();
    const c = p.cardOf(p.r2, 203);
    goTo(p, c);
    connect(p.mA, true);
    p.mutate();
    p.location.href = "https://www.netflix.com/browse?jbv=203";
    p.mutate();
    connect(p.mA, false);
    p.location.href = "https://www.netflix.com/browse";
    p.mutate();
    expect(p.on()).toBe(c);
  });
  test("Netflix redraws the row with new nodes: the highlight lands on the same title in the same row", () => {
    const p = page();
    goTo(p, p.cardOf(p.r2, 203));
    connect(p.mA, true);
    p.mutate();
    connect(p.mA, false);
    connect(p.r2, false);
    connect(p.r2b, true);
    p.mutate();
    expect(p.on()).toBe(p.cardOf(p.r2b, 203));
  });
  test("the row is redrawn a moment after the pop-up closes", () => {
    const p = page();
    goTo(p, p.cardOf(p.r2, 203));
    connect(p.mA, true);
    p.mutate();
    connect(p.mA, false);
    connect(p.r2, false);
    p.mutate();
    connect(p.r2b, true);
    p.mutate();
    expect(p.on()).toBe(p.cardOf(p.r2b, 203));
  });
  test("the saved title is waited for: the title now in its slot is not taken for it", () => {
    const p = page();
    const c = p.cardOf(p.r2, 203);
    goTo(p, c);
    connect(p.mA, true);
    p.mutate();
    connect(p.mA, false);
    connect(p.r2, false);
    // The redrawn row has other titles where 203 was; 203 itself has not arrived yet.
    p.r2b.querySelectorAll("a").forEach((a, i) => (a.attrs.href = `/browse?jbv=${900 + i}`));
    connect(p.r2b, true);
    p.mutate();
    const slotCard = p.r2b.querySelectorAll("a")[2]!;
    expect(p.on()).not.toBe(slotCard);
    p.wait(1500);
    p.mutate();
    expect(p.on()).not.toBe(slotCard);
    // 203 turns up in another slot a moment later: that is where the highlight goes.
    p.r2b.querySelectorAll("a")[1]!.attrs.href = "/browse?jbv=203";
    p.mutate();
    expect(p.on()).toBe(p.r2b.querySelectorAll("a")[1]);
  });
  test("a title that never comes back: after the wait the card in the same row and slot gets it", () => {
    const p = page();
    goTo(p, p.cardOf(p.r2, 203));
    connect(p.mA, true);
    p.mutate();
    connect(p.mA, false);
    connect(p.r2, false);
    p.r2b.querySelectorAll("a").forEach((a, i) => (a.attrs.href = `/browse?jbv=${900 + i}`));
    connect(p.r2b, true);
    p.mutate();
    p.wait(3100);
    p.mutate();
    expect(p.on()).toBe(p.r2b.querySelectorAll("a")[2]);
  });
  test("the page comes back scrolled exactly as it was, not just with the card in view", () => {
    const p = page();
    const c = p.cardOf(p.r3, 302);
    goTo(p, c);
    p.scroll.y = 240;
    p.fire("scroll", c);
    connect(p.mA, true);
    p.mutate();
    connect(p.mA, false);
    // Netflix throws the page back to the top while it closes the pop-up.
    p.scroll.y = 0;
    p.mutate();
    expect(p.scroll.y).toBe(240);
    expect(p.on()).toBe(c);
  });
  test("the row's carousel comes back to the page it was on", () => {
    const p = page();
    const opener = p.cardOf(p.r2, 203);
    goTo(p, opener);
    const left = opener.rect.left;
    const next = p.r2b
      .querySelectorAll("button")
      .find((b) => b.uia === "carousel-hawkins-right-button")!;
    connect(p.mA, true);
    p.mutate();
    connect(p.mA, false);
    connect(p.r2, false);
    // The redrawn row starts at its first page: the card sits a card-width to the right of where it was.
    const held = p.cardOf(p.r2b, 203);
    held.rect.right = left + 238 + (held.rect.right - held.rect.left);
    held.rect.left = left + 238;
    next.click = () => {
      next.clicks++;
      held.rect.left -= 238;
      held.rect.right -= 238;
    };
    connect(p.r2b, true);
    p.mutate();
    p.wait(1000);
    expect(next.clicks).toBe(1);
    expect(held.rect.left).toBe(left);
  });
  test("the opener is scrolled back into view", () => {
    const p = page();
    const c = p.cardOf(p.r3, 302);
    goTo(p, c);
    connect(p.mA, true);
    p.mutate();
    connect(p.mA, false);
    p.scroll.y = 900;
    p.mutate();
    const r = p.on()!.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(720);
    expect(p.on()).toBe(c);
  });
  test("nested pop-ups unwind one level at a time", () => {
    const p = page();
    const c = p.cardOf(p.r2, 202);
    goTo(p, c);
    connect(p.mA, true);
    p.mutate();
    const inA = p.mA.querySelector('[data-uia="A-play"]')!;
    expect(p.on()).not.toBe(c);
    p.key("ArrowDown");
    while (p.on() !== inA) p.key("ArrowDown");
    connect(p.mB, true);
    p.mutate();
    connect(p.mB, false);
    p.mutate();
    expect(p.on()).toBe(inA);
    connect(p.mA, false);
    p.mutate();
    expect(p.on()).toBe(c);
  });
  test("asks whether a pop-up is open, so Back closes it rather than going back in history", () => {
    const p = page();
    expect(p.run("window.__couchPopupOpen()")).toBe(false);
    connect(p.mA, true);
    p.mutate();
    expect(p.run("window.__couchPopupOpen()")).toBe(true);
    connect(p.mA, false);
    p.mutate();
    expect(p.run("window.__couchPopupOpen()")).toBe(false);
  });
  test("the player is never a pop-up: Back there stays history", () => {
    const p = page();
    connect(p.mA, true);
    p.mutate();
    p.location.href = "https://www.netflix.com/watch/1";
    expect(p.run("window.__couchPopupOpen()")).toBe(false);
  });
});
