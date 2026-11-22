import { describe, expect, test } from "vite-plus/test";
import vm from "node:vm";
import {
  CONFIRM_MESSAGE,
  confirmScript,
  noteScript,
  searchBarScript,
  volumeScript,
} from "./web-hud.ts";

describe("the page's confirmation", () => {
  test("its buttons take the mouse: hover focuses, click answers", () => {
    const script = confirmScript({ title: "Q", buttons: ["Cancel", "Quit"], focus: 0 });
    expect(script).toContain("couch:confirm-hover:");
    expect(script).toContain("couch:confirm:");
    expect(script).toContain("'pointer-events':'auto'");
  });
});

describe("the page's confirmation, run for real", () => {
  class Node {
    children: Node[] = [];
    handlers: Record<string, Function[]> = {};
    style = { setProperty() {} };
    id = "";
    textContent = "";
    addEventListener(type: string, f: Function) {
      (this.handlers[type] ??= []).push(f);
    }
    appendChild(n: Node) {
      this.children.push(n);
    }
    remove() {}
  }
  function run(confirm: Parameters<typeof confirmScript>[0]) {
    const logs: string[] = [];
    const body = new Node();
    const sandbox: any = {
      innerWidth: 1920,
      innerHeight: 1080,
      console: { debug: (m: string) => logs.push(m) },
      addEventListener() {},
      document: {
        body,
        documentElement: new Node(),
        getElementById: () => null,
        createElement: () => new Node(),
        createElementNS: () => new Node(),
      },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(confirmScript(confirm), sandbox);
    const row = body.children[0]!.children[0]!.children[1]!;
    return { logs, buttons: row.children };
  }
  const fire = (n: Node, type: string) =>
    (n.handlers[type] ?? []).forEach((f) => f({ stopPropagation() {} }));
  test("hovering a button and clicking it send the console messages the host answers", () => {
    const { logs, buttons } = run({
      title: "Leave YouTube?",
      buttons: ["Stay", "Go to Home"],
      focus: 0,
    });
    fire(buttons[1]!, "mouseenter");
    fire(buttons[0]!, "click");
    expect(logs).toEqual(["couch:confirm-hover:1", "couch:confirm:0"]);
    expect(logs.every((m) => CONFIRM_MESSAGE.test(m))).toBe(true);
  });
  test("it needs no <style> element: the CSP ignores them", () => {
    expect(confirmScript({ title: "Q", buttons: ["a", "b"], focus: 0 })).not.toMatch(
      /'style'|<style/,
    );
  });
});

describe("Couch's overlays when the page's zoom changes, run for real", () => {
  class El {
    children: El[] = [];
    attrs = new Map<string, string>();
    props = new Map<string, string>();
    handlers: Record<string, Function[]> = {};
    id = "";
    textContent = "";
    removed = false;
    style = { setProperty: (k: string, v: string) => this.props.set(k, v) };
    doc: Doc;
    constructor(doc: Doc) {
      this.doc = doc;
    }
    setAttribute(k: string, v: string) {
      this.attrs.set(k, v);
    }
    getAttribute(k: string) {
      return this.attrs.get(k) ?? null;
    }
    addEventListener(type: string, f: Function) {
      (this.handlers[type] ??= []).push(f);
    }
    appendChild(n: El) {
      this.children.push(n);
      if (n.id) this.doc.byId.set(n.id, n);
    }
    querySelector(sel: string) {
      const role = /data-role=(\w+)/.exec(sel)?.[1];
      return this.children.find((c) => c.attrs.get("data-role") === role) ?? new El(this.doc);
    }
    animate() {}
    remove() {
      this.removed = true;
      this.doc.byId.delete(this.id);
    }
  }
  class Doc {
    byId = new Map<string, El>();
    body = new El(this);
    documentElement = new El(this);
    getElementById = (id: string) => this.byId.get(id) ?? null;
    createElement = () => new El(this);
    createElementNS = () => new El(this);
  }

  /** A 1920 pt wide window: the page's innerWidth is the window width over the zoom, as in Chromium. */
  function page(zoom: number) {
    const document = new Doc();
    const timers: Array<() => void> = [];
    const sandbox: any = {
      innerHeight: 0,
      innerWidth: 0,
      document,
      console: { debug() {} },
      setTimeout: (f: () => void) => timers.push(f),
    };
    sandbox.window = sandbox;
    const setZoom = (z: number) => {
      sandbox.innerWidth = 1920 / z;
      sandbox.innerHeight = 1080 / z;
    };
    setZoom(zoom);
    vm.createContext(sandbox);
    return {
      document,
      timers,
      run: (script: string) => vm.runInContext(script, sandbox),
      /** What Chromium does: the zoom changes and innerWidth with it. No script runs in the page. */
      zoomTo: setZoom,
      /** A length the overlay set on an element, in on-screen points: calc(N * var(--couch-u)) times the zoom. */
      onScreen(el: El, prop: string, zoom: number) {
        const v = el.props.get(prop)!;
        // The browser resolves the unit's viewport lengths; here it is done by hand from the page's current innerWidth/innerHeight.
        const unit = /^min\(100vw \/ ([\d.]+), 100vh \/ ([\d.]+)\)$/.exec(
          document.documentElement.props.get("--couch-u")!,
        );
        if (!unit) throw new Error("--couch-u is not in viewport units");
        const u = Math.min(
          sandbox.innerWidth / Number(unit[1]),
          sandbox.innerHeight / Number(unit[2]),
        );
        const m = /^calc\(([-\d.]+) \* var\(--couch-u\)\)$/.exec(v);
        if (!m) throw new Error(`${prop} is not sized from --couch-u: ${v}`);
        return Number(m[1]) * u * zoom;
      },
    };
  }

  // The same overlay at zoom 1.5 then 1.8: the design width 1000 is 1000 * 1920/1920 = 1000 pt on a 1920 window either way.
  const cases: Array<[string, string, string, string, number]> = [
    ["search bar", "couch-search", "width", searchBarScript("abc", "Search"), 1000],
    ["volume pill", "couch-volume", "height", volumeScript(40), 380],
    ["note", "couch-note", "padding", noteScript("Hello"), 0],
    [
      "confirmation",
      "couch-confirm",
      "",
      confirmScript({ title: "Q", buttons: ["a", "b"], focus: 1 }),
      0,
    ],
  ];
  for (const [name, id, prop, script, design] of cases) {
    test(`the ${name} keeps its on-screen size when the zoom changes`, () => {
      const p = page(1.5);
      p.run(script);
      const el = p.document.byId.get(id)!;
      const target = name === "confirmation" ? el.children[0]! : el;
      const key = name === "confirmation" ? "gap" : name === "note" ? "font-size" : prop;
      const read = (z: number) => {
        const v = target.props.get(key);
        return v === undefined ? undefined : p.onScreen(target, key, z);
      };
      const before = read(1.5);
      expect(before).toBeGreaterThan(0);
      if (design) expect(before).toBeCloseTo(design, 5);
      p.zoomTo(1.8);
      expect(read(1.8)).toBeCloseTo(before!, 5);
      p.zoomTo(1);
      expect(read(1)).toBeCloseTo(before!, 5);
      expect(el.removed).toBe(false);
    });
  }

  test("a note keeps its one 4 s timer and its element across a zoom change", () => {
    const p = page(1.5);
    p.run(noteScript("Hello"));
    const el = p.document.byId.get("couch-note")!;
    p.zoomTo(1.8);
    expect(p.document.byId.get("couch-note")).toBe(el);
    expect(p.timers).toHaveLength(1);
  });

  test("a confirmation keeps its element, buttons and focused button across a zoom change", () => {
    const p = page(1.5);
    p.run(confirmScript({ title: "Q", buttons: ["a", "b"], focus: 1 }));
    const w = p.document.byId.get("couch-confirm")!;
    const row = w.children[0]!.children[1]!;
    const focusedBefore = row.children.map((b) => b.props.get("background"));
    p.zoomTo(1.8);
    expect(p.document.byId.get("couch-confirm")).toBe(w);
    expect(row.children.map((b) => b.props.get("background"))).toEqual(focusedBefore);
    expect(focusedBefore[0]).not.toBe(focusedBefore[1]);
  });

  test("redrawing at the same zoom updates the search bar in place", () => {
    const p = page(1.5);
    p.run(searchBarScript("a", "Search"));
    const el = p.document.byId.get("couch-search")!;
    p.run(searchBarScript("ab", "Search"));
    expect(el.removed).toBe(false);
    expect(p.document.byId.get("couch-search")).toBe(el);
  });

  test("no overlay needs a script to run when the zoom changes: sizes are in viewport units, set once", () => {
    const p = page(1.5);
    p.run(volumeScript(10));
    p.run(noteScript("n"));
    p.run(searchBarScript("a", "S"));
    p.run(confirmScript({ title: "Q", buttons: ["a", "b"], focus: 0 }));
    const root = p.document.documentElement.props;
    expect(root.get("--couch-u")).toBe("min(100vw / 1920, 100vh / 1080)");
  });
});
