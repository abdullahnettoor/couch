import { describe, expect, test } from "vite-plus/test";
import { pictureOffPage } from "../../shared/picture-off.ts";
import { PictureCover, type CoverHost, type CoverView } from "./picture-cover.ts";

class FakeView implements CoverView {
  calls: string[] = [];
  bounds?: { width: number; height: number };
  url = "";
  keyHandler?: (event: { preventDefault(): void }, input: { type: string; key: string }) => void;
  webContents = {
    loadURL: (url: string) => {
      this.url = url;
      return Promise.resolve();
    },
    on: (_event: "before-input-event", handler: FakeView["keyHandler"]) => {
      this.keyHandler = handler;
    },
    focus: () => this.calls.push("focus"),
  };
  setBounds(b: { x: number; y: number; width: number; height: number }) {
    this.bounds = b;
  }
  setVisible(v: boolean) {
    this.calls.push(`visible:${v}`);
  }
}

function setup() {
  const children: unknown[] = [];
  const host: CoverHost = {
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
    getContentBounds: () => ({ width: 1920, height: 1080 }),
  };
  const commands: unknown[] = [];
  const cover = new FakeView();
  const picture = new PictureCover(
    host,
    () => cover,
    (c) => commands.push(c),
  );
  const appView = new FakeView();
  children.push(appView);
  return { children, picture, cover, appView, commands };
}

describe("the Picture off cover", () => {
  test("sits above the web App's view, even one added after it, and covers the whole window", () => {
    const { children, picture, cover, appView } = setup();
    picture.set(true);
    expect(children).toEqual([appView, cover]);
    expect(cover.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    const later = new FakeView();
    children.push(later);
    picture.set(true);
    expect(children.at(-1)).toBe(cover);
  });

  test("never hides, shows or focuses the App's page", () => {
    const { picture, appView } = setup();
    picture.set(true);
    picture.set(true);
    picture.set(false);
    expect(appView.calls).toEqual([]);
  });

  test("going off removes it", () => {
    const { children, picture, appView } = setup();
    picture.set(true);
    picture.set(false);
    expect(children).toEqual([appView]);
  });

  test("its page is black, has the hint, and no script or visibility hooks", () => {
    const { picture, cover } = setup();
    picture.set(true);
    const html = decodeURIComponent(cover.url.replace(/^data:text\/html;charset=utf-8,/, ""));
    expect(html).toBe(pictureOffPage());
    expect(html).toContain("Picture off — press any key to turn it back on");
    expect(html).not.toMatch(/<script|visibilitychange|document\.hidden/);
  });

  test("a key pressed while the cover has focus goes to the core as a Screen key", () => {
    const { picture, cover, commands } = setup();
    picture.set(true);
    let prevented = false;
    cover.keyHandler!(
      { preventDefault: () => (prevented = true) },
      { type: "keyDown", key: "ArrowUp" },
    );
    expect(commands).toEqual([{ command: "up" }]);
    expect(prevented).toBe(true);
  });
});
