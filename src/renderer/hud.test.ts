import { beforeAll, describe, expect, test } from "vite-plus/test";
import type { Command, ScreenPayload } from "../shared/protocol.ts";

class Node {
  children: Node[] = [];
  handlers: Record<string, Function[]> = {};
  style = { setProperty() {}, height: "", background: "" } as Record<string, any>;
  classList = { toggle() {} };
  className = "";
  textContent = "";
  innerHTML = "";
  addEventListener(type: string, f: Function) {
    (this.handlers[type] ??= []).push(f);
  }
  replaceChildren() {
    this.children = [];
  }
  append(...nodes: Node[]) {
    this.children.push(...nodes);
  }
  querySelector() {
    return new Node();
  }
  fire(type: string) {
    const event = { stopPropagation() {} };
    for (const f of this.handlers[type] ?? []) f(event);
  }
}

const sent: Command[] = [];
const confirmEl = new Node();
let renderConfirm: (p: ScreenPayload) => void;

beforeAll(async () => {
  const g = globalThis as any;
  g.document = {
    getElementById: (id: string) => (id === "confirm" ? confirmEl : new Node()),
    createElement: () => new Node(),
  };
  g.window = { couch: { send: (c: Command) => sent.push(c) } };
  ({ renderConfirm } = await import("./hud.ts"));
});

const payload = (focus: number): ScreenPayload =>
  ({
    state: { confirm: { title: "Quit Couch?", buttons: ["Cancel", "Quit"], focus } },
  }) as unknown as ScreenPayload;
const buttons = () => confirmEl.children[0]!.children[1]!.children;

describe("the Screen's confirmation", () => {
  test("hover focuses a button and click answers it", () => {
    sent.length = 0;
    renderConfirm(payload(0));
    buttons()[1]!.fire("mouseenter");
    buttons()[0]!.fire("click");
    expect(sent).toEqual([
      { command: "focusAt", args: { r: 0, c: 1 } },
      { command: "confirmAt", args: { index: 0 } },
    ]);
  });

  test("a click after the hover redraw still works", () => {
    sent.length = 0;
    renderConfirm(payload(0));
    const stale = buttons()[1]!;
    stale.fire("mouseenter");
    renderConfirm(payload(1));
    expect(buttons()[1]).not.toBe(stale);
    buttons()[1]!.fire("click");
    expect(sent.at(-1)).toEqual({ command: "confirmAt", args: { index: 1 } });
  });

  test("a welcome question draws its body between the title and three answers", () => {
    sent.length = 0;
    renderConfirm({
      state: {
        confirm: {
          title: "Netflix now plays in sharper quality",
          body: "It needs its own sign-in.",
          buttons: ["Copy sign-in from Couch", "Sign in on Netflix", "Keep using Chromium"],
          focus: 0,
          phone: true,
        },
      },
    } as unknown as ScreenPayload);
    const box = confirmEl.children[0]!;
    expect(box.children.map((c) => c.textContent)).toEqual([
      "Netflix now plays in sharper quality",
      "It needs its own sign-in.",
      "",
    ]);
    const row = box.children[2]!.children;
    expect(row.map((b) => b.textContent)).toEqual([
      "Copy sign-in from Couch",
      "Sign in on Netflix",
      "Keep using Chromium",
    ]);
    row[2]!.fire("mouseenter");
    row[2]!.fire("click");
    expect(sent).toEqual([
      { command: "focusAt", args: { r: 0, c: 2 } },
      { command: "confirmAt", args: { index: 2 } },
    ]);
  });
});
