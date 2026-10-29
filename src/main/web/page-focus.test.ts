import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import {
  FIELD_BLURRED,
  FIELD_FOCUSED,
  pageFocusFunction,
  type FocusLayout,
  pickInDirection,
  typeIntoFieldScript,
  type Box,
} from "./page-focus.ts";
import { runFocusScript } from "./page-focus-runner.ts";
import { NETFLIX_LAYOUT } from "../apps/netflix/netflix-web.ts";

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
  name: string;
  /** A modal container (found by the modal selector) rather than a control. */
  modal = false;
  /** Not a control (a cover, a backdrop): it only occludes. */
  plain = false;
  parent: El | null = null;
  /** Paint order: the higher layer is on top where they overlap. */
  layer = 0;
  zIndex = "auto";
  constructor(name: string, rect: Box, tagName = "BUTTON") {
    this.name = name;
    this.rect = rect;
    this.tagName = tagName;
  }
  contains(other: El): boolean {
    for (let e: El | null = other; e; e = e.parent) if (e === this) return true;
    return false;
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
  blur() {
    this.focused = false;
    if (doc.activeElement === this) doc.activeElement = null;
  }
  /** An open <dialog> shown with showModal(): it paints in the browser's top layer. */
  topLayer = false;
  matches(sel: string) {
    return sel === ":modal" && this.topLayer;
  }
  scrollIntoView() {}
  hasAttribute(a: string) {
    return a === "disabled" && this.disabled;
  }
}
let doc: any;
function setup(
  els: El[],
  selectors?: string[],
  layout?: FocusLayout,
  href = "https://www.netflix.com/browse",
) {
  doc = {
    activeElement: null,
    readyState: "complete",
    body: { appendChild: () => {} },
    documentElement: {
      attrs: new Set<string>(),
      children: [] as any[],
      appendChild(n: any) {
        this.children.push(n);
      },
      setAttribute(n: string) {
        this.attrs.add(n);
      },
      removeAttribute(n: string) {
        this.attrs.delete(n);
      },
    },
    // The modal selector finds modals; any other selector finds the controls.
    querySelectorAll: (sel: string) =>
      els.filter((e) => e.connected && (/dialog|modal/.test(sel) ? e.modal : !e.modal && !e.plain)),
    // Hit-testing as the browser does it: a live shield (full viewport, pointer events on) is topmost.
    elementsFromPoint: (x: number, y: number) => {
      const hits: any[] = els
        .filter((e) => {
          const r = e.rect;
          return (
            e.connected && !e.hidden && x >= r.left && x < r.right && y >= r.top && y < r.bottom
          );
        })
        .reverse() // later in the document paints over earlier at the same layer
        .sort((a, b) => b.layer - a.layer);
      const shield = doc.documentElement.children.find(
        (n: any) => n.id === "couch-shield" && !n.removed,
      );
      return shield ? [shield, ...hits] : hits;
    },
    elementFromPoint: (x: number, y: number) => doc.elementsFromPoint(x, y)[0] ?? null,
  };
  const run = runFocusScript(pageFocusFunction(selectors, layout), {
    document: doc,
    href,
    width: 1000,
    height: 800,
    getComputedStyle: (e: El) => ({ visibility: "visible", display: "block", zIndex: e.zIndex }),
  });
  return { ...run, doc };
}

describe("page focus script", () => {
  // From the middle of a 1000x800 view the nearest control is b.
  const mk = () => [
    new El("a", box(100, 100)),
    new El("b", box(300, 100)),
    new El("c", box(100, 300)),
  ];
  test("a ring shows on a sensible control as soon as the page is ready", () => {
    const [a, b, c] = mk();
    const { key, ring } = setup([a, b, c]);
    expect(ring.style.display).toBe("block");
    key("Enter");
    expect([a.clicks, b.clicks, c.clicks]).toEqual([0, 1, 0]);
  });
  test("a page with nothing to focus yet gets its ring when something appears", () => {
    const els: El[] = [];
    const { ring, mutate, key } = setup(els);
    expect(ring.style.display).not.toBe("block");
    const late = new El("late", box(400, 400));
    els.push(late);
    mutate();
    expect(ring.style.display).toBe("block");
    key("Enter");
    expect(late.clicks).toBe(1);
  });
  test("arrows move the ring and OK clicks the focused control", () => {
    const [a, b, c] = mk();
    const { key, ring } = setup([a, b, c]);
    key("ArrowLeft");
    key("Enter");
    expect(a.clicks).toBe(1);
    expect(ring.style.display).toBe("block");
    key("ArrowDown");
    key("Enter");
    expect(c.clicks).toBe(1);
  });
  test("skips disabled and invisible controls", () => {
    const [a, b, c] = mk();
    b.disabled = true;
    const { key } = setup([a, b, c]);
    key("ArrowDown");
    key("Enter");
    expect(b.clicks).toBe(0);
    expect(a.clicks + c.clicks).toBe(1);
  });
  test("ignores keys the page handled", () => {
    const [a, b, c] = mk();
    const { key } = setup([a, b, c]);
    key("ArrowLeft", { defaultPrevented: true });
    key("Enter", { defaultPrevented: true });
    expect(a.clicks + b.clicks + c.clicks).toBe(0);
    key("Enter");
    expect(b.clicks).toBe(1);
  });
  test("defers to a page handler that runs after Couch's and prevents default", () => {
    const [a, b, c] = mk();
    const { key } = setup([a, b, c]);
    key("ArrowLeft", { later: (e: any) => e.preventDefault() });
    key("Enter", { later: (e: any) => e.preventDefault() });
    expect(a.clicks + b.clicks + c.clicks).toBe(0);
    key("Enter");
    expect(b.clicks).toBe(1);
  });
  test("an element removed from the page: a replacement is picked at once", () => {
    const [a, b, c] = mk();
    const { key, ring, mutate } = setup([a, b, c]);
    b.connected = false;
    mutate();
    expect(ring.style.display).toBe("block");
    key("Enter");
    expect(b.clicks).toBe(0);
    expect(a.clicks + c.clicks).toBe(1);
  });
  test("when the last control goes, the ring goes, and nothing throws", () => {
    const [a] = [new El("a", box(100, 100))];
    const { key, ring, mutate } = setup([a]);
    a.connected = false;
    expect(() => {
      mutate();
      key("ArrowRight");
      key("Enter");
    }).not.toThrow();
    expect(ring.style.display).toBe("none");
  });
  test("after the page navigates the ring is picked again", () => {
    const [a, b, c] = mk();
    const { key, mutate, location } = setup([a, b, c]);
    c.rect = box(450, 375);
    location.href = "https://www.netflix.com/browse/genre/1";
    mutate();
    key("Enter");
    expect(c.clicks).toBe(1);
  });
  test("OK on a text field focuses it; then left/right/enter stay with the page", () => {
    const input = new El("email", box(100, 100), "INPUT");
    const { key } = setup([input]);
    key("Enter");
    expect(input.focused).toBe(true);
    const e = key("ArrowLeft");
    expect(e.defaultPrevented).toBe(false);
    expect(key("Enter").defaultPrevented).toBe(false);
  });
  test("moving the ring off a text field blurs it, so OK activates the new control", () => {
    const input = new El("email", box(100, 100), "INPUT");
    const button = new El("sign in", box(100, 300));
    const { key } = setup([input, button]);
    key("ArrowUp");
    key("Enter");
    expect(input.focused).toBe(true);
    key("ArrowDown");
    expect(input.focused).toBe(false);
    expect(doc.activeElement).toBe(null);
    key("Enter");
    expect(button.clicks).toBe(1);
  });
  test("tells Couch when a text field has focus and when it lets go", () => {
    const input = new El("email", box(100, 100), "INPUT");
    const button = new El("go", box(100, 300));
    const { fire, logs } = setup([input, button]);
    fire("focusin", button);
    expect(logs).toEqual([]);
    fire("focusin", input);
    fire("focusout", input);
    expect(logs).toEqual([FIELD_FOCUSED, FIELD_BLURRED]);
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
  test("the ring is an outline: no fill, so it can never tint what is behind it", () => {
    const { ring } = setup(mk());
    expect(ring.style.display).toBe("block");
    expect(ring.style.background).toMatch(/^(none|transparent)$/);
    expect(ring.style.backgroundColor ?? "").toBe("");
    expect(ring.style.border).toMatch(/solid/);
  });
  test("never lands on an element that is most of the viewport", () => {
    const huge = new El("player", box(0, 0, 1000, 700));
    const big = new El("wide", box(0, 0, 1000, 450));
    const small = new El("small", box(600, 600));
    const { key, ring } = setup([huge, big, small]);
    key("Enter");
    expect([huge.clicks, big.clicks, small.clicks]).toEqual([0, 0, 1]);
    key("ArrowUp");
    key("Enter");
    expect(huge.clicks + big.clicks).toBe(0);
    expect(ring.style.display).toBe("block");
    small.connected = false;
    const only = setup([new El("full", box(0, 0, 1000, 800))]);
    expect(only.ring.style.display).not.toBe("block");
  });
  describe("layers", () => {
    // A page with three controls, and a dialog opened over the middle of it with its own two.
    const page = () => {
      const under = [
        new El("a", box(100, 100)),
        new El("b", box(300, 100)),
        new El("c", box(100, 300)),
      ];
      const dialog = new El("dialog", box(250, 50, 400, 300), "DIV");
      dialog.modal = true;
      dialog.layer = 10;
      const inA = new El("in-a", box(300, 100));
      const inB = new El("in-b", box(450, 100));
      for (const e of [inA, inB]) {
        e.parent = dialog;
        e.layer = 11;
      }
      return { under, dialog, inA, inB };
    };
    test("with a dialog open, the highlight is only inside it", () => {
      const { under, dialog, inA, inB } = page();
      const els = [...under, dialog, inA, inB];
      const { key, ring } = setup(els);
      expect(ring.style.display).toBe("block");
      for (const k of ["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight", "ArrowDown"]) {
        key(k);
        key("Enter");
      }
      expect(under.map((e) => e.clicks)).toEqual([0, 0, 0]);
      expect(inA.clicks + inB.clicks).toBeGreaterThan(0);
    });
    test("aria-modal and the site's own container count as modals", () => {
      const { under, dialog, inA } = page();
      dialog.modal = true;
      const { key } = setup([...under, dialog, inA], undefined, { scopes: [".site-modal"] });
      key("Enter");
      expect(inA.clicks).toBe(1);
    });
    test("with two dialogs open, only the topmost is reachable", () => {
      const { under, dialog, inA, inB } = page();
      const top = new El("top", box(0, 0, 200, 200), "DIV");
      top.modal = true;
      top.layer = 20;
      top.zIndex = "20";
      const inTop = new El("in-top", box(20, 20, 50, 50));
      inTop.parent = top;
      inTop.layer = 21;
      const { key } = setup([...under, dialog, inA, inB, top, inTop]);
      key("Enter");
      key("ArrowRight");
      key("Enter");
      expect([inA.clicks, inB.clicks, ...under.map((e) => e.clicks)]).toEqual([0, 0, 0, 0, 0]);
      expect(inTop.clicks).toBeGreaterThan(0);
    });
    test("a modal that changes the address (/browse to /browse?jbv=) still gives the ring back to its opener", () => {
      const { under, dialog, inA, inB } = page();
      for (const e of [dialog, inA, inB]) e.connected = false;
      const { key, mutate, location } = setup([...under, dialog, inA, inB]);
      key("ArrowLeft");
      location.href = "https://www.netflix.com/browse?jbv=80100172";
      for (const e of [dialog, inA, inB]) e.connected = true;
      mutate();
      location.href = "https://www.netflix.com/browse";
      for (const e of [dialog, inA, inB]) e.connected = false;
      mutate();
      key("Enter");
      expect(under[0].clicks).toBe(1);
    });
    test("a real page change (another path) forgets the opener", () => {
      const { under, dialog, inA, inB } = page();
      for (const e of [dialog, inA, inB]) e.connected = false;
      const { key, mutate, location } = setup([...under, dialog, inA, inB]);
      key("ArrowLeft");
      for (const e of [dialog, inA, inB]) e.connected = true;
      mutate();
      location.href = "https://www.netflix.com/title/1";
      for (const e of [dialog, inA, inB]) e.connected = false;
      mutate();
      key("Enter");
      expect(under[0].clicks).toBe(0);
      expect(under[1].clicks).toBe(1);
    });
    test("nested modals: closing the inner one returns to the control held in the one beneath", () => {
      const { under, dialog, inA, inB } = page();
      const inner = new El("inner", box(0, 0, 200, 200), "DIV");
      inner.modal = true;
      inner.layer = 20;
      const inC = new El("in-c", box(20, 20, 50, 50));
      inC.parent = inner;
      inC.layer = 21;
      for (const e of [inner, inC]) e.connected = false;
      const { key, mutate } = setup([...under, dialog, inA, inB, inner, inC]);
      key("ArrowLeft");
      key("Enter");
      expect(inA.clicks).toBe(1);
      for (const e of [inner, inC]) e.connected = true;
      mutate();
      key("Enter");
      expect(inC.clicks).toBe(1);
      for (const e of [inner, inC]) e.connected = false;
      mutate();
      key("Enter");
      expect(inA.clicks).toBe(2);
      expect(inB.clicks).toBe(0);
      for (const e of [dialog, inA, inB]) e.connected = false;
      mutate();
      key("Enter");
      expect(under[1].clicks).toBe(1);
    });
    test("the topmost modal is the one painted on top, not the one with the higher own z-index", () => {
      const { under, dialog, inA, inB } = page();
      dialog.zIndex = "1000";
      dialog.layer = 5;
      inA.layer = inB.layer = 6;
      const over = new El("over", box(250, 50, 400, 300), "DIV");
      over.modal = true;
      over.layer = 10;
      const inOver = new El("in-over", box(300, 200));
      inOver.parent = over;
      inOver.layer = 11;
      const { key } = setup([...under, dialog, inA, inB, over, inOver]);
      key("Enter");
      expect(inOver.clicks).toBe(1);
      expect(inA.clicks + inB.clicks).toBe(0);
    });
    test("a top-layer <dialog> is topmost whatever else overlaps it", () => {
      const { under, dialog, inA, inB } = page();
      dialog.topLayer = true;
      const over = new El("over", box(400, 200, 200, 150), "DIV");
      over.modal = true;
      over.layer = 30;
      const inOver = new El("in-over", box(450, 250, 50, 50));
      inOver.parent = over;
      inOver.layer = 31;
      const { key } = setup([...under, dialog, inA, inB, over, inOver]);
      key("Enter");
      expect(inOver.clicks).toBe(0);
      expect(inA.clicks + inB.clicks).toBe(1);
    });
    test("a covered control is skipped even with no modal (something drawn over its middle)", () => {
      const a = new El("a", box(100, 100));
      const covered = new El("covered", box(300, 100));
      const sheet = new El("sheet", box(280, 80, 150, 100), "DIV");
      sheet.plain = true;
      sheet.layer = 5;
      const { key } = setup([a, covered, sheet]);
      key("ArrowRight");
      key("Enter");
      expect(covered.clicks).toBe(0);
      expect(a.clicks).toBe(1);
    });
    test("a control partly covered but with its middle free still counts", () => {
      const a = new El("a", box(100, 100));
      const b = new El("b", box(300, 100));
      const edge = new El("edge", box(380, 80, 60, 100), "DIV");
      edge.plain = true;
      edge.layer = 5;
      const { key } = setup([a, b, edge]);
      key("ArrowRight");
      key("Enter");
      expect(b.clicks).toBe(1);
    });
    test("an element off the edge of the viewport is judged at its visible middle", () => {
      const a = new El("a", box(100, 100));
      const edge = new El("edge", box(950, 400, 200, 50));
      const { key } = setup([a, edge]);
      key("ArrowDown");
      key("Enter");
      expect(edge.clicks).toBe(1);
    });
    test("the ring moves into a dialog the moment it opens over the held control", () => {
      const { under, dialog, inA, inB } = page();
      dialog.connected = false;
      inA.connected = false;
      inB.connected = false;
      const all = [...under, dialog, inA, inB];
      const { key, mutate } = setup(all);
      key("ArrowRight");
      key("Enter");
      expect(under[1].clicks).toBe(1);
      for (const e of [dialog, inA, inB]) e.connected = true;
      mutate();
      key("Enter");
      expect(under[1].clicks).toBe(1);
      expect(inA.clicks + inB.clicks).toBe(1);
    });
    test("when the dialog closes the ring returns to the control that opened it", () => {
      const { under, dialog, inA, inB } = page();
      for (const e of [dialog, inA, inB]) e.connected = false;
      const { key, mutate } = setup([...under, dialog, inA, inB]);
      key("ArrowRight");
      for (const e of [dialog, inA, inB]) e.connected = true;
      mutate();
      for (const e of [dialog, inA, inB]) e.connected = false;
      mutate();
      key("Enter");
      expect(under[1].clicks).toBe(1);
      expect(inA.clicks + inB.clicks).toBe(0);
    });
    test("the opener is remembered even when a backdrop covers it before the dialog itself shows", () => {
      const { under, dialog, inA, inB } = page();
      const backdrop = new El("backdrop", box(0, 0, 1000, 800), "DIV");
      backdrop.plain = true;
      backdrop.layer = 9;
      for (const e of [backdrop, dialog, inA, inB]) e.connected = false;
      const { key, mutate } = setup([...under, backdrop, dialog, inA, inB]);
      key("ArrowRight");
      backdrop.connected = true;
      mutate();
      for (const e of [dialog, inA, inB]) e.connected = true;
      mutate();
      expect(inA.clicks + inB.clicks).toBe(0);
      key("Enter");
      expect(inA.clicks + inB.clicks).toBe(1);
      for (const e of [backdrop, dialog, inA, inB]) e.connected = false;
      mutate();
      key("Enter");
      expect(under[1].clicks).toBe(1);
    });
    test("when the opener is gone after the dialog closes, any visible control gets the ring", () => {
      const { under, dialog, inA, inB } = page();
      for (const e of [dialog, inA, inB]) e.connected = false;
      const { key, mutate, ring } = setup([...under, dialog, inA, inB]);
      key("ArrowRight");
      for (const e of [dialog, inA, inB]) e.connected = true;
      mutate();
      for (const e of [dialog, inA, inB]) e.connected = false;
      under[1].connected = false;
      mutate();
      expect(ring.style.display).toBe("block");
      key("Enter");
      expect(under[0].clicks + under[2].clicks).toBe(1);
    });
  });
  test("other keys are untouched", () => {
    const { key } = setup(mk());
    expect(key("a").defaultPrevented).toBe(false);
  });
});

describe("typing into the page's focused field", () => {
  class HTMLInputElement {
    _v = "";
    setViaNative = false;
    get value() {
      return this._v;
    }
    set value(v: string) {
      this._v = v;
      this.setViaNative = true;
    }
  }
  class Input extends HTMLInputElement {
    tagName = "INPUT";
    type = "email";
    isContentEditable = false;
    events: string[] = [];
    dispatchEvent(e: { type: string }) {
      this.events.push(e.type);
    }
  }
  function page(active: unknown) {
    const sandbox: any = {
      document: { activeElement: active },
      HTMLInputElement,
      HTMLTextAreaElement: class {},
      Event: class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    };
    vm.createContext(sandbox);
    return (text: string) => vm.runInContext(typeIntoFieldScript(text), sandbox) as boolean;
  }
  test("text goes into the focused field and the page is told, through the field's own setter", () => {
    const input: any = new Input();
    const type = page(input);
    expect(type("dummy@example.invalid")).toBe(true);
    expect(input._v).toBe("dummy@example.invalid");
    expect(input.setViaNative).toBe(true);
    expect(input.events).toEqual(["input", "change"]);
    type("!");
    expect(input._v).toBe("dummy@example.invalid!");
  });
  test("with no field focused it does nothing and says so", () => {
    expect(page(null)(" x")).toBe(false);
    const button: any = new Input();
    button.tagName = "BUTTON";
    expect(page(button)("x")).toBe(false);
    const box: any = new Input();
    box.type = "checkbox";
    expect(page(box)("x")).toBe(false);
  });
});

describe("D-pad mode (no hover from a resting mouse)", () => {
  const shieldOf = (d: any) =>
    d.documentElement.children.find((n: any) => n.id === "couch-shield" && !n.removed);
  test("a key raises one transparent, cursorless shield over the viewport, with no <style>", () => {
    const { key, doc } = setup([new El("a", box(100, 100)), new El("b", box(300, 100))]);
    key("ArrowRight");
    key("ArrowRight");
    const live = doc.documentElement.children.filter(
      (n: any) => n.id === "couch-shield" && !n.removed,
    );
    expect(live).toHaveLength(1);
    expect(live[0].style.cursor).toBe("none");
    expect(live[0].style.pointerEvents).toBe("auto");
    expect(live[0].style.position).toBe("fixed");
    expect(doc.documentElement.children.some((n: any) => n.textContent !== undefined)).toBe(false);
  });
  test("navigation still finds candidates while the shield is up", () => {
    const [a, b] = [new El("a", box(100, 100)), new El("b", box(300, 100))];
    const { key, doc } = setup([a, b]);
    key("ArrowRight");
    expect(shieldOf(doc)).toBeTruthy();
    key("Enter");
    expect(b.clicks).toBe(1);
    key("ArrowLeft");
    key("Enter");
    expect(a.clicks).toBe(1);
  });
  test("real mouse movement removes the shield", () => {
    const { key, fire, doc } = setup([new El("a", box(100, 100)), new El("b", box(300, 100))]);
    key("ArrowRight");
    fire("mousemove", null, mv(500, 400));
    fire("mousemove", null, mv(560, 400));
    expect(shieldOf(doc)).toBeUndefined();
  });
  const dpad = (d: any) => d.documentElement.attrs.has("data-couch-dpad");
  const mv = (x: number, y: number, isTrusted = true) => ({ isTrusted, clientX: x, clientY: y });
  const els = () => [new El("a", box(100, 100)), new El("b", box(300, 100))];
  test("a key puts the page in D-pad mode", () => {
    const { key, doc } = setup(els());
    expect(dpad(doc)).toBe(false);
    key("ArrowRight");
    expect(dpad(doc)).toBe(true);
  });
  test("a real mouse movement beyond a small threshold ends it", () => {
    const { key, fire, doc } = setup(els());
    key("ArrowRight");
    fire("mousemove", null, mv(500, 400));
    expect(dpad(doc)).toBe(true);
    fire("mousemove", null, mv(503, 402));
    expect(dpad(doc)).toBe(true);
    fire("mousemove", null, mv(540, 400));
    expect(dpad(doc)).toBe(false);
  });
  test("synthetic pointer events neither end it nor are blocked", () => {
    const { key, fire, doc } = setup(els());
    key("ArrowRight");
    fire("mousemove", null, mv(0, 0, false));
    fire("mousemove", null, mv(900, 700, false));
    expect(dpad(doc)).toBe(true);
  });
  test("Couch's own wake of a player's bar is a real move to the page, but it neither ends the shield nor anchors it", () => {
    const { key, fire, doc, run } = setup(els());
    key("ArrowRight");
    run("window.__couchWake = { x: 521, y: 415, at: Date.now() }");
    fire("mousemove", null, mv(521, 415));
    fire("mousemove", null, mv(522, 414));
    expect(dpad(doc)).toBe(true);
    // The household's mouse still ends it, but the wake left no anchor: the first real move sets it, the next ends it.
    fire("mousemove", null, mv(100, 100));
    expect(dpad(doc)).toBe(true);
    fire("mousemove", null, mv(300, 100));
    expect(dpad(doc)).toBe(false);
  });
  test("Down in the player brings the bar up and wakes the pointer through the host, and the shield stays", () => {
    const posted: any[] = [];
    const { key, fire, doc, run } = setup(
      els(),
      undefined,
      NETFLIX_LAYOUT,
      "https://www.netflix.com/watch/81234",
    );
    run(
      "window.__wakes = []; window.webkit = { messageHandlers: { couch: { postMessage: (m) => window.__wakes.push(m) } } }",
    );
    key("ArrowDown");
    posted.push(...(run("window.__wakes") as any[]));
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((m) => m.type === "wake-pointer")).toBe(true);
    for (const m of posted) fire("mousemove", null, mv(m.x, m.y));
    expect(dpad(doc)).toBe(true);
  });
  test("a real move far from the wake's point, or long after it, is the household's", () => {
    const { key, fire, doc, run } = setup(els());
    key("ArrowRight");
    run("window.__couchWake = { x: 521, y: 415, at: Date.now() - 5000 }");
    fire("mousemove", null, mv(521, 415));
    fire("mousemove", null, mv(700, 415));
    expect(dpad(doc)).toBe(false);
  });
  test("a key after mouse use goes back to D-pad mode", () => {
    const { key, fire, doc } = setup(els());
    key("ArrowRight");
    fire("mousemove", null, mv(500, 400));
    fire("mousemove", null, mv(600, 400));
    expect(dpad(doc)).toBe(false);
    key("ArrowLeft");
    expect(dpad(doc)).toBe(true);
  });
});
