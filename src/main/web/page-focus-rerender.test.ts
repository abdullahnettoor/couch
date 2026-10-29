import { describe, expect, test } from "vite-plus/test";
import { pageFocusFunction } from "./page-focus.ts";
import { runFocusScript } from "./page-focus-runner.ts";
import { FakeEl, snapshotPage, type SnapNode } from "./snapshot-page.ts";

const button = (label: string, top: number, extra: Record<string, string> = {}): SnapNode => ({
  t: "button",
  a: { "data-name": label, ...extra },
  r: [100, top, 300, 60],
});

/** A page of a list of buttons, run with the real focus script; `replace` swaps one for a fresh element the way a re-render does. */
function rig(labels: string[]) {
  const snap = {
    url: "https://www.netflix.com/",
    view: { width: 1000, height: 800 },
    tree: {
      t: "div",
      r: [0, 0, 1000, 800],
      c: [{ t: "ul", r: [0, 0, 1000, 800], c: labels.map((l, i) => button(l, 100 + i * 100)) }],
    } as SnapNode,
  };
  const page = snapshotPage(snap);
  const list = page.root.children[0]!;
  const run = runFocusScript(pageFocusFunction(), {
    document: page.doc,
    href: snap.url,
    width: 1000,
    height: 800,
    scroll: page.scroll,
    getComputedStyle: () => ({ visibility: "visible", display: "block", zIndex: "auto" }),
  });
  const named = (n: string) => page.all.find((e) => e.attrs["data-name"] === n && e.connected)!;
  const ok = () => {
    const before = new Map(page.all.map((e) => [e, e.clicks]));
    run.key("Enter");
    return page.all.find((e) => e.clicks > before.get(e)!)?.attrs["data-name"];
  };
  /** The page replaces the button called `name` with a new element at the same place, after `later` (none: at once). */
  const replace = (name: string, mid?: () => void) => {
    const old = named(name);
    const i = list.children.indexOf(old);
    old.connected = false;
    list.children.splice(i, 1);
    mid?.();
    const fresh = new FakeEl(
      { t: "button", a: old.attrs, r: [old.rect.left, old.rect.top, 300, 60] },
      page.scroll,
    );
    fresh.parent = list;
    list.children.splice(i, 0, fresh);
    page.all.push(fresh);
    run.mutate();
  };
  /** The household walks the ring to the control called `name`. */
  const hold = (name: string) => {
    for (let i = 0; i < 8 && ok() !== name; i++) run.key(i < 4 ? "ArrowUp" : "ArrowDown");
    expect(ok()).toBe(name);
  };
  return { ...run, page, named, ok, replace, list, hold };
}

describe("the ring after the page replaces the held control", () => {
  test("a re-rendered control gets the ring back, not whatever is nearest the middle", () => {
    const p = rig(["Top", "Get Help", "Continue", "Footer"]);
    p.hold("Get Help");
    p.replace("Get Help");
    expect(p.ok()).toBe("Get Help");
  });

  test("it stays on the replacement when the held control is the first or last of the list", () => {
    const p = rig(["First", "Mid", "Last"]);
    p.hold("First");
    p.replace("First");
    p.replace("First");
    expect(p.ok()).toBe("First");
  });

  test("a control that comes back a moment later still gets the ring (the page removes, then adds)", () => {
    const p = rig(["Top", "Continue", "Get Help"]);
    p.hold("Get Help");
    p.replace("Get Help", () => {
      p.mutate();
      expect(p.ring.style.display).toBe("none");
    });
    expect(p.ok()).toBe("Get Help");
  });

  test("a control that is gone for good: the ring waits a moment, then picks by position", () => {
    const p = rig(["Top", "Continue", "Get Help"]);
    p.hold("Get Help");
    const gone = p.named("Get Help");
    gone.connected = false;
    p.list.children.splice(p.list.children.indexOf(gone), 1);
    p.mutate();
    expect(p.ring.style.display).toBe("none");
    p.wait(1100);
    expect(p.ring.style.display).toBe("block");
    expect(p.ok()).not.toBe("Get Help");
  });

  test("a control that is removed from the middle: the ring goes to what sits in its place", () => {
    const p = rig(["Top", "Get Help", "Continue"]);
    p.hold("Get Help");
    const gone = p.named("Get Help");
    gone.connected = false;
    p.list.children.splice(p.list.children.indexOf(gone), 1);
    p.mutate();
    expect(p.ok()).toBe("Continue");
  });

  test("moving the ring clears what was being waited for", () => {
    const p = rig(["Top", "Continue", "Get Help"]);
    p.hold("Get Help");
    const gone = p.named("Get Help");
    gone.connected = false;
    p.list.children.splice(p.list.children.indexOf(gone), 1);
    p.mutate();
    p.wait(1100);
    p.hold("Continue");
    p.key("ArrowUp");
    expect(p.ok()).toBe("Top");
  });
});
