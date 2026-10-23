import { describe, expect, test } from "vite-plus/test";
import { type Snapshot, type SnapNode } from "../../web/snapshot-page.ts";
import { connect, netflixPage } from "./netflix-test-page.ts";

const link = (r: [number, number, number, number], text: string): SnapNode => ({
  t: "span",
  a: { "data-uia": "tag-item" },
  r,
  c: [{ t: "a", a: { href: "#", "data-text": text }, r }],
});

/** A details pop-up: cast and genre links sit nearer the screen's middle than the action buttons. */
function popup(opts: { play?: string | false }): SnapNode {
  const actions: SnapNode[] = [];
  if (opts.play !== false) {
    actions.push({
      t: "a",
      a: {
        "data-uia": "play-button",
        role: "link",
        tabindex: "0",
        href: "#",
        "data-text": opts.play ?? "Play",
      },
      r: [267, 403, 118, 45],
      c: [{ t: "button", a: { tabindex: "-1" }, r: [267, 403, 118, 45] }],
    });
  }
  actions.push(
    { t: "button", a: { "data-uia": "add-to-my-list" }, r: [393, 406, 38, 38] },
    { t: "button", a: { "data-uia": "thumbs-rate-button" }, r: [439, 406, 38, 38] },
  );
  return {
    t: "div",
    a: { "data-uia": "modal-motion-container-DETAIL_MODAL", role: "dialog", tabindex: "-1" },
    r: [215, 32, 850, 640],
    c: [
      { t: "div", a: { "data-uia": "mini-modal-controls" }, r: [263, 399, 340, 53], c: actions },
      {
        t: "span",
        a: { "data-uia": "previewModal-closebtn", role: "button", tabindex: "0" },
        r: [1013, 68, 36, 20],
      },
      link([600, 340, 80, 18], "cast"),
      link([700, 560, 90, 18], "genre"),
      link([263, 600, 70, 18], "cast"),
    ],
  };
}

function setup(opts: { play?: string | false }) {
  const snap: Snapshot = {
    url: "https://www.netflix.com/browse",
    view: { width: 1280, height: 720 },
    tree: {
      t: "body",
      r: [0, 0, 1280, 720],
      c: [
        {
          t: "section",
          a: { "data-uia": "carousel-row-section-1" },
          r: [0, 100, 1280, 178],
          c: [
            {
              t: "a",
              a: { "data-uia": "standard-card", tabindex: "0", href: "/browse?jbv=11" },
              r: [48, 140, 230, 129],
            },
            {
              t: "a",
              a: { "data-uia": "standard-card", tabindex: "0", href: "/browse?jbv=12" },
              r: [286, 140, 230, 129],
            },
          ],
        },
        popup(opts),
      ],
    },
  };
  const p = netflixPage(snap, undefined, (page) => connect(page.root.children[1]!, false));
  const modal = p.root.children[1]!;
  const missing = new Set<string>();
  const open = () => {
    connect(modal, true);
    p.all.filter((e) => missing.has(e.uia)).forEach((e) => connect(e, false));
    p.mutate();
    p.location.href = "https://www.netflix.com/browse?jbv=12";
    p.mutate();
  };
  const close = () => {
    connect(modal, false);
    p.location.href = "https://www.netflix.com/browse";
    p.mutate();
  };
  /** The pop-up's controls with this data-uia are not on the page yet (or are again). */
  const expose = (uia: string, visible: boolean) => {
    if (visible) missing.delete(uia);
    else missing.add(uia);
    p.all.filter((e) => e.uia === uia).forEach((e) => connect(e, visible));
  };
  return { ...p, open, close, expose };
}

describe("a title's pop-up opens on its Play control", () => {
  for (const label of ["Play", "Resume", "Continue", "Play S1:E1"]) {
    test(`"${label}" is highlighted, not the cast or genre links`, () => {
      const p = setup({ play: label });
      p.key("ArrowRight");
      p.open();
      expect(p.on()?.uia).toBe("play-button");
    });
  }
  test("no play control: the first action button, never a text link", () => {
    const p = setup({ play: false });
    p.open();
    expect(p.on()?.uia).toBe("add-to-my-list");
  });
  test("moving inside the pop-up is not overridden", () => {
    const p = setup({ play: "Play" });
    p.open();
    p.key("ArrowRight");
    expect(p.on()?.uia).toBe("add-to-my-list");
    p.mutate();
    p.key("ArrowRight");
    p.mutate();
    expect(p.on()?.uia).toBe("thumbs-rate-button");
  });
  test("Back returns to the card that opened it", () => {
    const p = setup({ play: "Play" });
    p.key("ArrowRight");
    const card = p.on();
    expect(card?.uia).toBe("standard-card");
    p.open();
    expect(p.on()?.uia).toBe("play-button");
    p.close();
    expect(p.on()).toBe(card);
  });
});

describe("a pop-up whose action controls load late", () => {
  const openBare = () => {
    const p = setup({ play: "Play" });
    p.key("ArrowRight");
    for (const uia of ["play-button", "add-to-my-list", "thumbs-rate-button"]) p.expose(uia, false);
    p.open();
    return p;
  };
  test("Enter never clicks a cast or genre link while waiting", () => {
    const p = openBare();
    expect(p.on()?.uia).not.toBe("tag-item");
    expect(p.on()?.getAttribute("data-text")).not.toBe("cast");
    p.wait(2000);
    p.mutate();
    expect(p.on()?.getAttribute("data-text")).not.toBe("cast");
  });
  test("Play, exposed after 3.1 s, is highlighted", () => {
    const p = openBare();
    p.wait(3100);
    p.mutate();
    expect(p.on()).toBeUndefined();
    p.expose("play-button", true);
    p.expose("add-to-my-list", true);
    p.mutate();
    expect(p.on()?.uia).toBe("play-button");
  });
  test("only My List appearing: My List is highlighted", () => {
    const p = openBare();
    p.wait(5000);
    p.expose("add-to-my-list", true);
    p.mutate();
    expect(p.on()?.uia).toBe("add-to-my-list");
  });
  test("moving the highlight while waiting ends the wait", () => {
    const p = openBare();
    p.key("ArrowRight");
    const moved = p.on();
    p.expose("play-button", true);
    p.mutate();
    expect(p.on()).toBe(moved);
  });
});
