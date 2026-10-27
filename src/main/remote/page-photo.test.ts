import { beforeEach, describe, expect, test } from "vite-plus/test";
import { PAGE_HTML, runPage } from "./page-runner.ts";

interface El {
  hidden: boolean;
  textContent: string;
  value: string;
  files?: unknown[];
  clicked: number;
  handlers: Record<string, () => void>;
  classes: Set<string>;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The page's script against a plain fake DOM, a fake canvas and a fake photo decoder. */
function loadPage() {
  const els = new Map<string, El>();
  for (const m of PAGE_HTML.matchAll(/<(\w+)[^>]*?\sid="([^"]+)"[^>]*>/g)) {
    els.set(m[2]!, {
      hidden: /\shidden[\s>]/.test(m[0]),
      textContent: "",
      value: "",
      clicked: 0,
      handlers: {},
      classes: new Set(),
    });
  }
  const proxies = new Map<string, unknown>();
  for (const [id, e] of els) {
    proxies.set(
      id,
      new Proxy(e, {
        get(t, k: string) {
          if (k in t) return (t as never)[k];
          if (k === "addEventListener") return (n: string, f: () => void) => (t.handlers[n] = f);
          if (k === "click") return () => t.clicked++;
          if (k === "classList")
            return {
              add: (c: string) => t.classes.add(c),
              remove: (c: string) => t.classes.delete(c),
              toggle: () => {},
            };
          if (k === "style") return { setProperty() {} };
          if (k === "disabled") return false;
          if (k === "getAttribute") return () => null;
          return () => {};
        },
        set(t, k: string, v) {
          Object.assign(t, { [k]: v });
          return true;
        },
      }),
    );
  }
  const draws: Array<{ w: number; h: number }> = [];
  const blobs: Array<{ type: string; quality: number }> = [];
  const order: string[] = [];
  const state = { blobSize: 1000, decodeFails: false };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      fillRect() {},
      drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => {
        order.push("draw");
        draws.push({ w, h });
      },
    }),
    toBlob(cb: (b: unknown) => void, type: string, quality: number) {
      order.push("blob");
      blobs.push({ type, quality });
      cb({ size: state.blobSize, b64: "AAECAw==" });
    },
  };
  class FileReader {
    result = "";
    onload?: () => void;
    onerror?: () => void;
    readAsDataURL(blob: { b64: string }) {
      this.result = `data:image/jpeg;base64,${blob.b64}`;
      void Promise.resolve().then(() => this.onload?.());
    }
  }
  const document = {
    getElementById: (id: string) => proxies.get(id),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: (tag: string) => (tag === "canvas" ? canvas : {}),
    body: { classList: { toggle() {} } },
  };
  let size = { width: 4000, height: 3000 };
  const { sent, sockets } = runPage({
    document,
    FileReader,
    createImageBitmap: () =>
      state.decodeFails
        ? Promise.reject(new Error("no"))
        : Promise.resolve({ ...size, close() {} }),
  });
  sockets[0]!.onopen!();
  const snapshot = (over: Record<string, unknown> = {}) =>
    sockets[0]!.onmessage!({
      data: JSON.stringify({
        type: "snapshot",
        where: "Home",
        remotes: 1,
        layout: "settings",
        typing: "none",
        volume: 40,
        muted: false,
        ...over,
      }),
    });
  const pick = async (w: number, h: number) => {
    size = { width: w, height: h };
    els.get("photo-file")!.files = [{ name: "p.jpg" }];
    els.get("photo-file")!.handlers.change!();
    await flush();
    await flush();
  };
  return { els, sent, snapshot, pick, draws, blobs, order, state, canvas };
}

let page: ReturnType<typeof loadPage>;
beforeEach(() => {
  page = loadPage();
});
const photoCommands = () =>
  page.sent.map((s) => JSON.parse(s)).filter((m) => m.command === "addPhoto");

describe("Add photo on the phone", () => {
  test("it shows only while the Screen is on Settings → Home", () => {
    page.snapshot();
    expect(page.els.get("addphoto")!.hidden).toBe(true);
    page.snapshot({ view: "settingsHome", addPhoto: true, where: "Home" });
    expect(page.els.get("addphoto")!.hidden).toBe(false);
    page.snapshot({ view: "settings" });
    expect(page.els.get("addphoto")!.hidden).toBe(true);
  });

  test("it is hidden while something is playing", () => {
    page.snapshot({
      addPhoto: true,
      nowPlaying: {
        title: "x",
        folder: "y",
        position: 1,
        duration: 2,
        paused: false,
        subtitlesOn: false,
      },
    });
    expect(page.els.get("addphoto")!.hidden).toBe(true);
  });

  test("tapping it opens the phone's photo picker, which takes images", () => {
    page.els.get("addphoto")!.handlers.click!();
    expect(page.els.get("photo-file")!.clicked).toBe(1);
    expect(PAGE_HTML).toMatch(/<input type="file" id="photo-file" accept="image\/\*"/);
  });

  test("a big photo is shrunk to fit 2560×1440 and encoded as JPEG at 0.85 before it is sent", async () => {
    await page.pick(4000, 3000);
    expect(page.draws).toEqual([{ w: 1920, h: 1440 }]);
    expect(page.canvas.width).toBe(1920);
    expect(page.canvas.height).toBe(1440);
    expect(page.blobs).toEqual([{ type: "image/jpeg", quality: 0.85 }]);
    expect(page.order).toEqual(["draw", "blob"]);
    expect(photoCommands()).toEqual([
      { type: "command", command: "addPhoto", args: { data: "AAECAw==" } },
    ]);
  });

  test("a wide camera photo is limited by its width, a tall one by its height", async () => {
    await page.pick(5120, 2000);
    expect(page.draws.at(-1)).toEqual({ w: 2560, h: 1000 });
    await page.pick(3000, 6000);
    expect(page.draws.at(-1)).toEqual({ w: 720, h: 1440 });
  });

  test("a small photo is not enlarged", async () => {
    await page.pick(800, 600);
    expect(page.draws).toEqual([{ w: 800, h: 600 }]);
  });

  test("a photo still over 3 MB after encoding is refused with a toast and not sent", async () => {
    page.state.blobSize = 3 * 1024 * 1024 + 1;
    await page.pick(4000, 3000);
    expect(photoCommands()).toEqual([]);
    expect(page.els.get("gtoast")!.textContent).toMatch(/too big/i);
    expect(page.els.get("gtoast")!.classes.has("show")).toBe(true);
  });

  test("exactly 3 MB is accepted", async () => {
    page.state.blobSize = 3 * 1024 * 1024;
    await page.pick(4000, 3000);
    expect(photoCommands()).toHaveLength(1);
  });

  test("a file the phone can't decode toasts and sends nothing", async () => {
    page.state.decodeFails = true;
    await page.pick(100, 100);
    expect(photoCommands()).toEqual([]);
    expect(page.els.get("gtoast")!.textContent).toMatch(/read/i);
  });

  test("cancelling the picker sends nothing", async () => {
    page.els.get("photo-file")!.files = [];
    page.els.get("photo-file")!.handlers.change!();
    await flush();
    expect(photoCommands()).toEqual([]);
  });
});
