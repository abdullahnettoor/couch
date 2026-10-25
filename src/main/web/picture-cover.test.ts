import { describe, expect, test } from "vite-plus/test";
import { pictureOffPage } from "../../shared/picture-off.ts";
import { volumeScript } from "./web-hud.ts";
import { PictureCover, type CoverHost, type CoverView } from "./picture-cover.ts";

class FakeView implements CoverView {
  calls: string[] = [];
  bounds?: { width: number; height: number };
  url = "";
  keyHandler?: (event: { preventDefault(): void }, input: { type: string; key: string }) => void;
  scripts: string[] = [];
  webContents = {
    executeJavaScript: (script: string) => {
      this.scripts.push(script);
      return Promise.resolve();
    },
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
  const host: CoverHost<FakeView> = {
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
  const picture = new PictureCover<FakeView>(
    host,
    () => cover,
    (c) => commands.push(c),
  );
  const appView = new FakeView();
  children.push(appView);
  return { children, picture, cover, appView, commands };
}

const key = (k: string, type = "keyDown") => ({ type, key: k });
const event = () => {
  const e = { prevented: false, preventDefault: () => (e.prevented = true) };
  return e;
};

describe("the Picture off cover", () => {
  test("swallows a physical key sent to the App's page while on, and restores the picture", () => {
    const { picture, commands } = setup();
    picture.set(true);
    const e = event();
    expect(picture.intercept(e, key("ArrowDown"))).toBe(true);
    expect(e.prevented).toBe(true);
    expect(commands).toEqual([{ command: "down" }]);
  });

  test("a site's shortcut is swallowed and only restores; a key with no Screen meaning restores too", () => {
    const { picture, commands } = setup();
    picture.set(true);
    const e = event();
    expect(picture.intercept(e, key("k"))).toBe(true);
    expect(e.prevented).toBe(true);
    expect(commands).toEqual([{ command: "screenKey", args: { text: "k" } }]);
    commands.length = 0;
    expect(picture.intercept(event(), key("F5"))).toBe(true);
    expect(commands).toEqual([{ command: "setPictureOff", args: { on: false } }]);
  });

  test.each([" ", "MediaPlayPause"])(
    "%j sends play/pause, swallowed, and the cover stays on",
    (k) => {
      const { picture, commands } = setup();
      picture.set(true);
      const e = event();
      expect(picture.intercept(e, key(k))).toBe(true);
      expect(e.prevented).toBe(true);
      expect(commands).toEqual([{ command: "playpause" }]);
      expect(picture.intercept(event(), key("k"))).toBe(true);
    },
  );

  test("a key release is swallowed without a second command", () => {
    const { picture, commands } = setup();
    picture.set(true);
    const e = event();
    expect(picture.intercept(e, key("k", "keyUp"))).toBe(true);
    expect(e.prevented).toBe(true);
    expect(commands).toEqual([]);
  });

  test("while off, the App's keys are left alone", () => {
    const { picture, commands } = setup();
    const e = event();
    expect(picture.intercept(e, key("k"))).toBe(false);
    picture.set(true);
    picture.set(false);
    expect(picture.intercept(e, key("k"))).toBe(false);
    expect(e.prevented).toBe(false);
    expect(commands).toEqual([]);
  });

  test("shows the volume level on the cover, and clears it", () => {
    const { picture, cover } = setup();
    picture.set(true);
    picture.showVolume(40);
    expect(cover.scripts.at(-1)).toBe(volumeScript(40));
    picture.showVolume(undefined);
    expect(cover.scripts.at(-1)).toBe(volumeScript(undefined));
  });

  test("shows nothing on the cover while it's off", () => {
    const { picture, cover } = setup();
    picture.showVolume(40);
    picture.set(true);
    picture.set(false);
    picture.showVolume(40);
    expect(cover.scripts).toEqual([]);
  });

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

  test("keys on the cover's own page go first to whatever draws above it, and don't end Picture off then", () => {
    const children: unknown[] = [];
    const host: CoverHost<FakeView> = {
      contentView: { children, addChildView: (v) => children.push(v), removeChildView: () => {} },
      getContentBounds: () => ({ width: 1920, height: 1080 }),
    };
    const cover = new FakeView();
    const commands: unknown[] = [];
    let taken = true;
    const picture = new PictureCover<FakeView>(
      host,
      () => cover,
      (c) => commands.push(c),
      () => taken,
    );
    picture.set(true);
    cover.keyHandler!(event(), key("q"));
    expect(commands).toEqual([]);
    taken = false;
    cover.keyHandler!(event(), key("q"));
    expect(commands).toEqual([{ command: "screenKey", args: { text: "q" } }]);
  });
});
