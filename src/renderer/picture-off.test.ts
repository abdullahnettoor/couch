import { beforeAll, describe, expect, test } from "vite-plus/test";
import type { ScreenPayload } from "../shared/protocol.ts";

const cover = { hidden: true, innerHTML: "" };
const head: unknown[] = [];
const reads: string[] = [];
const listeners: string[] = [];
let renderPictureOff: (p: ScreenPayload) => void;

beforeAll(async () => {
  const g = globalThis as any;
  g.document = {
    getElementById: (id: string) => (id === "picture-off" ? cover : {}),
    createElement: () => ({}),
    head: { append: (n: unknown) => head.push(n) },
    addEventListener: (type: string) => listeners.push(type),
    get hidden() {
      reads.push("hidden");
      return false;
    },
    get visibilityState() {
      reads.push("visibilityState");
      return "visible";
    },
  };
  g.addEventListener = (type: string) => listeners.push(type);
  ({ renderPictureOff } = await import("./picture-off.ts"));
});

const payload = (pictureOff: boolean) => ({ state: { pictureOff } }) as unknown as ScreenPayload;

describe("the Screen's Picture off cover", () => {
  test("shows black with the mark and hint while on, and goes away when off", () => {
    expect(cover.innerHTML).toContain("Picture off — press any key to turn it back on");
    renderPictureOff(payload(true));
    expect(cover.hidden).toBe(false);
    renderPictureOff(payload(false));
    expect(cover.hidden).toBe(true);
  });

  test("never reads visibility or listens for visibilitychange", () => {
    renderPictureOff(payload(true));
    renderPictureOff(payload(false));
    renderPictureOff(payload(true));
    expect(reads).toEqual([]);
    expect(listeners).toEqual([]);
  });
});
