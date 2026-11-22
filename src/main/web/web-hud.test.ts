import { describe, expect, test } from "vite-plus/test";
import vm from "node:vm";
import { CONFIRM_MESSAGE, confirmScript, searchBarScript } from "./web-hud.ts";

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
      document: {
        body,
        getElementById: () => null,
        createElement: () => new Node(),
        createElementNS: () => new Node(),
      },
    };
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

describe("the search bar under a page zoom change, run for real", () => {
  class El {
    children: El[] = [];
    attrs = new Map<string, string>();
    props = new Map<string, string>();
    id = "";
    textContent = "";
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
      this.doc.byId.delete(this.id);
      this.doc.removed++;
    }
  }
  class Doc {
    byId = new Map<string, El>();
    removed = 0;
    body = new El(this);
    getElementById = (id: string) => this.byId.get(id) ?? null;
    createElement = () => new El(this);
    createElementNS = () => new El(this);
  }
  function page(innerWidth: number) {
    const document = new Doc();
    const sandbox: any = { innerWidth, innerHeight: 1080, document };
    vm.createContext(sandbox);
    const draw = (text: string) => vm.runInContext(searchBarScript(text, "Search"), sandbox);
    return { document, sandbox, draw };
  }

  test("the same zoom updates the bar in place", () => {
    const { document, draw } = page(1280);
    draw("a");
    draw("ab");
    expect(document.removed).toBe(0);
    expect(document.byId.get("couch-search")!.props.get("width")).toBe(`${1000 * (1280 / 1920)}px`);
  });

  test("a zoom change while the bar is open draws it again at the new zoom (its on-screen size is kept)", () => {
    const { document, sandbox, draw } = page(1280);
    draw("a");
    const old = document.byId.get("couch-search")!;
    sandbox.innerWidth = 1024;
    draw("a");
    const bar = document.byId.get("couch-search")!;
    expect(document.removed).toBe(1);
    expect(bar).not.toBe(old);
    expect(bar.props.get("width")).toBe(`${1000 * (1024 / 1920)}px`);
  });
});
