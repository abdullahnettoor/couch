import { beforeAll, describe, expect, test } from "vite-plus/test";
import type { ScreenPayload } from "../shared/protocol.ts";

const cover = { hidden: true, innerHTML: "" };
const head: unknown[] = [];
let renderPictureOff: (p: ScreenPayload) => void;

beforeAll(async () => {
  const g = globalThis as any;
  g.document = {
    getElementById: (id: string) => (id === "picture-off" ? cover : {}),
    createElement: () => ({}),
    head: { append: (n: unknown) => head.push(n) },
  };
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

  test("never touches document.hidden or listens for visibilitychange", () => {
    const g = globalThis as any;
    expect(g.document.hidden).toBeUndefined();
    expect(g.document.addEventListener).toBeUndefined();
  });
});
