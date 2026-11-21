import { describe, expect, test } from "vite-plus/test";
import { matcher, snapshotPage, type Snapshot } from "./snapshot-page.ts";

const snap: Snapshot = {
  url: "https://x.example/",
  view: { width: 100, height: 100 },
  tree: {
    t: "body",
    r: [0, 0, 100, 100],
    c: [
      {
        t: "div",
        a: { class: "row group/track" },
        r: [0, 0, 100, 20],
        c: [
          { t: "span", r: [0, 0, 50, 20], c: [{ t: "a", a: { href: "/in" }, r: [0, 0, 50, 20] }] },
        ],
      },
      { t: "a", a: { href: "/out" }, r: [0, 30, 50, 20] },
      { t: "div", r: [0, 60, 100, 20], through: true },
      { t: "button", r: [0, 60, 50, 20] },
    ],
  },
};

describe("the fake page's selectors", () => {
  test("a descendant combinator looks up the ancestors in order", () => {
    const page = snapshotPage(snap);
    const hits = (sel: string) =>
      page.root.querySelectorAll(sel).map((e) => e.getAttribute("href"));
    expect(hits('[class*="group/track"] a')).toEqual(["/in"]);
    expect(hits('[class*="group/track"] span a[href^="/i"]')).toEqual(["/in"]);
    expect(hits('[class*="nothing"] a')).toEqual([]);
    expect(
      hits('[class*="group/track"] a, a[href="/out"]').toSorted((a, b) =>
        String(a).localeCompare(String(b)),
      ),
    ).toEqual(["/in", "/out"]);
    expect(matcher("a")(page.find("")[0]!)).toBe(false);
  });

  test("an element with pointer-events: none is never what a point hits", () => {
    const page = snapshotPage(snap);
    expect(page.doc.elementFromPoint(10, 70).tagName).toBe("BUTTON");
    expect(page.doc.elementsFromPoint(10, 70).some((e: { through: boolean }) => e.through)).toBe(
      false,
    );
  });
});
