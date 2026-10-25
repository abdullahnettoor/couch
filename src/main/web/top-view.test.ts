import { describe, expect, test } from "vite-plus/test";
import { TopView, type TopHost, type TopViewLike } from "./top-view.ts";

type Handler = (event: { preventDefault(): void }, input: { type: string; key: string }) => void;

class FakeView implements TopViewLike {
  bounds?: { x: number; y: number; width: number; height: number };
  url = "";
  handlers: Handler[] = [];
  loads = 0;
  webContents = {
    loadURL: (url: string) => {
      this.url = url;
      this.loads++;
      return Promise.resolve();
    },
    on: (_event: "before-input-event", handler: Handler) => this.handlers.push(handler),
  };
  setBounds(b: { x: number; y: number; width: number; height: number }) {
    this.bounds = b;
  }
}

function setup(width = 1920) {
  const children: unknown[] = [];
  const size = { width, height: 1080 };
  const host: TopHost<FakeView> = {
    contentView: {
      children,
      addChildView: (v) => {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
        children.push(v);
      },
      removeChildView: (v) => {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
      },
    },
    getContentBounds: () => size,
  };
  const created: FakeView[] = [];
  const inputs: string[] = [];
  const setups: FakeView[] = [];
  const top = new TopView<FakeView>(host, {
    create: () => {
      const v = new FakeView();
      created.push(v);
      return v;
    },
    page: () => "<p>hi</p>",
    onInput: (_e, input) => inputs.push(input.key),
    setup: (v) => setups.push(v),
  });
  const appView = new FakeView();
  children.push(appView);
  return { top, children, created, inputs, setups, appView, size };
}

describe("TopView", () => {
  test("creates nothing until shown, then creates once, loads the page and wires input", () => {
    const { top, created, inputs, setups } = setup();
    expect(created).toHaveLength(0);
    top.show();
    top.show();
    expect(created).toHaveLength(1);
    expect(created[0]!.loads).toBe(1);
    expect(created[0]!.url).toBe(`data:text/html;charset=utf-8,${encodeURIComponent("<p>hi</p>")}`);
    expect(setups).toEqual([created[0]]);
    created[0]!.handlers[0]!({ preventDefault() {} }, { type: "keyDown", key: "x" });
    expect(inputs).toEqual(["x"]);
  });

  test("fits the window and sits above every other view, and is lifted again after later ones", () => {
    const { top, children, created, appView, size } = setup();
    top.show();
    expect(children).toEqual([appView, created[0]]);
    expect(created[0]!.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    const late = new FakeView();
    children.push(late);
    top.show();
    expect(children.at(-1)).toBe(created[0]);
    size.width = 1280;
    top.fit();
    expect(created[0]!.bounds?.width).toBe(1280);
  });

  test("hide takes it out of the window but keeps the view for next time; other views are untouched", () => {
    const { top, children, created, appView } = setup();
    top.show();
    expect(top.shown).toBe(true);
    top.hide();
    expect(top.shown).toBe(false);
    expect(children).toEqual([appView]);
    top.show();
    expect(created).toHaveLength(1);
    expect(children).toEqual([appView, created[0]]);
  });

  test("fit does nothing before it was created or after it was hidden", () => {
    const { top, created } = setup();
    top.fit();
    expect(created).toHaveLength(0);
    top.show();
    top.hide();
    created[0]!.bounds = undefined;
    top.fit();
    expect(created[0]!.bounds).toBeUndefined();
  });
});
