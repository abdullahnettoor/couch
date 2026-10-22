import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { pageFocusFunction, pickInDirection, type Box } from "./page-focus.ts";

const box = (left: number, top: number, w = 100, h = 50): Box => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});
const view = { width: 1000, height: 800 };

describe("pickInDirection", () => {
  const cur = box(400, 400);
  test("picks the nearest in each direction", () => {
    const cands = [box(600, 400), box(200, 400), box(400, 250), box(400, 550), box(800, 400)];
    expect(pickInDirection(cur, cands, "right", view)).toBe(0);
    expect(pickInDirection(cur, cands, "left", view)).toBe(1);
    expect(pickInDirection(cur, cands, "up", view)).toBe(2);
    expect(pickInDirection(cur, cands, "down", view)).toBe(3);
  });
  test("prefers the aligned candidate over a nearer, offset one", () => {
    expect(pickInDirection(cur, [box(520, 600), box(400, 700)], "down", view)).toBe(1);
  });
  test("ties go to the earlier in document order", () => {
    expect(pickInDirection(cur, [box(600, 400), box(600, 400)], "right", view)).toBe(0);
  });
  test("nothing in that direction gives -1", () => {
    expect(pickInDirection(cur, [box(200, 400)], "right", view)).toBe(-1);
    expect(pickInDirection(cur, [], "up", view)).toBe(-1);
  });
  test("on-screen candidates beat nearer off-screen ones; off-screen used when alone", () => {
    expect(pickInDirection(cur, [box(400, 850), box(400, 700)], "down", view)).toBe(1);
    expect(pickInDirection(cur, [box(400, 1500)], "down", view)).toBe(0);
  });
  test("no current: picks the candidate nearest the viewport centre", () => {
    expect(pickInDirection(null, [box(0, 0), box(450, 380)], "down", view)).toBe(1);
  });
});

class El {
  rect: Box;
  disabled = false;
  hidden = false;
  connected = true;
  clicks = 0;
  focused = false;
  tagName: string;
  isContentEditable = false;
  constructor(
    public name: string,
    rect: Box,
    tagName = "BUTTON",
  ) {
    this.rect = rect;
    this.tagName = tagName;
  }
  get isConnected() {
    return this.connected;
  }
  getBoundingClientRect() {
    const r = this.hidden ? { left: 0, top: 0, right: 0, bottom: 0 } : this.rect;
    return { ...r, width: r.right - r.left, height: r.bottom - r.top };
  }
  click() {
    this.clicks++;
  }
  focus() {
    this.focused = true;
    doc.activeElement = this;
  }
  scrollIntoView() {}
  hasAttribute(a: string) {
    return a === "disabled" && this.disabled;
  }
}
let doc: any;
function setup(els: El[], selectors?: string[]) {
  const listeners: Record<string, Function[]> = {};
  const ring: any = { style: {}, remove() {}, setAttribute() {} };
  doc = {
    activeElement: null,
    body: { appendChild: () => {} },
    createElement: () => ring,
    querySelectorAll: (_s: string) => els.filter((e) => e.connected),
  };
  const sandbox: any = {
    document: doc,
    innerWidth: 1000,
    innerHeight: 800,
    console: { warn() {} },
    addEventListener: (t: string, f: Function) => (listeners[t] ??= []).push(f),
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    requestAnimationFrame: (f: Function) => f(),
    MutationObserver: class {
      observe() {}
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${pageFocusFunction(selectors)})()`, sandbox);
  const key = (k: string, extra: any = {}) => {
    const e = {
      key: k,
      defaultPrevented: false,
      preventDefault() {
        e.defaultPrevented = true;
      },
      ...extra,
    };
    for (const f of listeners.keydown ?? []) f(e);
    return e;
  };
  return { key, ring };
}

describe("page focus script", () => {
  const mk = () => [
    new El("a", box(100, 100)),
    new El("b", box(300, 100)),
    new El("c", box(100, 300)),
  ];
  test("arrows move the ring and OK clicks the focused control", () => {
    const [a, b, c] = mk();
    const { key, ring } = setup([a, b, c]);
    key("ArrowRight");
    key("ArrowRight");
    key("Enter");
    expect(b.clicks).toBe(1);
    expect(ring.style.display).not.toBe("none");
    key("ArrowLeft");
    key("ArrowDown");
    key("Enter");
    expect(c.clicks).toBe(1);
  });
  test("skips disabled and invisible controls", () => {
    const [a, b, c] = mk();
    b.disabled = true;
    const { key } = setup([a, b, c]);
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(b.clicks).toBe(0);
    expect(a.clicks + c.clicks).toBe(1);
    c.hidden = true;
  });
  test("ignores keys the page handled", () => {
    const [a, b, c] = mk();
    const { key } = setup([a, b, c]);
    key("ArrowRight", { defaultPrevented: true });
    key("Enter", { defaultPrevented: true });
    expect(a.clicks + b.clicks + c.clicks).toBe(0);
  });
  test("an element removed from the page: focus is found again, nothing throws", () => {
    const [a, b, c] = mk();
    const { key } = setup([a, b, c]);
    key("ArrowDown");
    key("ArrowDown");
    const target = [a, b, c].find((e) => e.clicks === 0)!;
    key("Enter");
    const hit = [a, b, c].find((e) => e.clicks === 1)!;
    hit.connected = false;
    expect(() => {
      key("ArrowRight");
      key("Enter");
    }).not.toThrow();
    expect([a, b, c].reduce((n, e) => n + e.clicks, 0)).toBe(2);
    expect(target).toBeDefined();
  });
  test("OK on a text field focuses it; then left/right/enter stay with the page", () => {
    const input = new El("email", box(100, 100), "INPUT");
    const { key } = setup([input]);
    key("ArrowDown");
    key("Enter");
    expect(input.focused).toBe(true);
    const e = key("ArrowLeft");
    expect(e.defaultPrevented).toBe(false);
    expect(key("Enter").defaultPrevented).toBe(false);
  });
  test("never throws when the page misbehaves", () => {
    const bad = new El("x", box(0, 0));
    bad.getBoundingClientRect = () => {
      throw new Error("boom");
    };
    const { key } = setup([bad]);
    expect(() => {
      key("ArrowRight");
      key("Enter");
    }).not.toThrow();
  });
  test("other keys are untouched", () => {
    const { key } = setup(mk());
    expect(key("a").defaultPrevented).toBe(false);
  });
});
