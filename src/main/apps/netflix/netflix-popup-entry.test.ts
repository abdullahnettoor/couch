import { describe, expect, test } from "vite-plus/test";
import { pageFocusFunction } from "../../web/page-focus.ts";
import { runFocusScript } from "../../web/page-focus-runner.ts";
import {
  snapshotPage,
  type FakeEl,
  type Snapshot,
  type SnapNode,
} from "../../web/snapshot-page.ts";
import { netflixDescription } from "./netflix-web.ts";

const desc = netflixDescription("130.0.6723.58");

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
  const p = snapshotPage(snap);
  const modal = p.root.children[1]!;
  const set = (el: FakeEl, on: boolean) => {
    el.connected = on;
    el.children.forEach((c) => set(c, on));
  };
  set(modal, false);
  const run = runFocusScript(pageFocusFunction(desc.focus!.selectors, desc.focus!.layout), {
    document: p.doc,
    href: snap.url,
    width: 1280,
    height: 720,
    scroll: p.scroll,
    getComputedStyle: () => ({
      visibility: "visible",
      display: "block",
      zIndex: "auto",
      position: "static",
    }),
  });
  const on = () => {
    const before = new Map(p.all.map((e) => [e, e.clicks]));
    run.key("Enter");
    const hit = p.all.find((e) => e.clicks > before.get(e)!);
    if (hit) hit.clicks--;
    return hit;
  };
  const open = () => {
    set(modal, true);
    run.mutate();
    run.location.href = "https://www.netflix.com/browse?jbv=12";
    run.mutate();
  };
  const close = () => {
    set(modal, false);
    run.location.href = "https://www.netflix.com/browse";
    run.mutate();
  };
  return { ...p, ...run, on, open, close };
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
