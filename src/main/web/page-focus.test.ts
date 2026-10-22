import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import {
  FIELD_BLURRED,
  FIELD_FOCUSED,
  pageFocusFunction,
  pickInDirection,
  typeIntoFieldScript,
  type Box,
} from "./page-focus.ts";

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
  constructor(name: string, rect: Box, tagName = "BUTTON") {
    this.name = name;
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
  blur() {
    this.focused = false;
    if (doc.activeElement === this) doc.activeElement = null;
  }
  scrollIntoView() {}
  hasAttribute(a: string) {
    return a === "disabled" && this.disabled;
  }
}
let doc: any;
function setup(els: El[], selectors?: string[]) {
  const listeners: Record<string, Function[]> = {};
  const timers: Function[] = [];
  const observers: Function[] = [];
  const logs: string[] = [];
  const ring: any = { style: {}, remove() {}, setAttribute() {} };
  doc = {
    activeElement: null,
    readyState: "complete",
    body: { appendChild: () => {} },
    createElement: () => ring,
    querySelectorAll: (_s: string) => els.filter((e) => e.connected),
  };
  const location = { href: "https://www.netflix.com/browse" };
  const sandbox: any = {
    document: doc,
    location,
    innerWidth: 1000,
    innerHeight: 800,
    console: { warn() {}, debug: (m: string) => logs.push(m) },
    addEventListener: (t: string, f: Function) => (listeners[t] ??= []).push(f),
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
    requestAnimationFrame: (f: Function) => f(),
    setTimeout: (f: Function) => timers.push(f),
    MutationObserver: class {
      constructor(f: Function) {
        observers.push(f);
      }
      observe() {}
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${pageFocusFunction(selectors)})()`, sandbox);
  /** The page's DOM changed (the observer fires), and any timers that follow run. */
  const mutate = () => {
    for (const f of observers) f([]);
    flush();
  };
  const flush = () => {
    while (timers.length) timers.shift()!();
  };
  /** One key: the page's handlers (`later` run after Couch's, like a handler registered later) then the end of dispatch. */
  const key = (k: string, extra: any = {}) => {
    const { later, ...rest } = extra;
    const e = {
      key: k,
      defaultPrevented: false,
      preventDefault() {
        e.defaultPrevented = true;
      },
      ...rest,
    };
    for (const f of listeners.keydown ?? []) f(e);
    later?.(e);
    flush();
    return e;
  };
  const fire = (type: string, target: El) => {
    for (const f of listeners[type] ?? []) f({ type, target });
  };
  return { key, ring, mutate, fire, logs, location };
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
