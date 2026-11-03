import { describe, expect, test } from "vite-plus/test";
import vm from "node:vm";
import { CONFIRM_MESSAGE, confirmScript } from "./web-hud.ts";

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
