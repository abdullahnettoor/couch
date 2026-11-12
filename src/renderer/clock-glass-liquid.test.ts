// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { designUnit } from "../shared/design-unit.ts";
import { GLASS } from "../shared/look.ts";
import { ClockGlass, type MapWorker } from "./clock-glass.ts";
import type { MapJob, Maps } from "./clock-glass-maps.ts";

/** A worker that answers when the test says so. */
class FakeWorker implements MapWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent<Maps>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  jobs: MapJob[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(job: MapJob) {
    this.jobs.push(job);
  }
  terminate() {
    this.terminated = true;
  }
  answer(n: number) {
    this.onmessage?.({ data: maps(n) } as MessageEvent<Maps>);
  }
  fail() {
    this.onerror?.({ message: "no canvas" } as ErrorEvent);
  }
}
const maps = (n: number): Maps => ({
  displacement: `data:image/png;base64,map${n}`,
  rim: `data:image/png;base64,rim${n}`,
});

let clock: HTMLElement;
let time: HTMLElement;
let glass: ClockGlass;
const lens = () => clock.querySelector<HTMLElement>(".cg-lens")!;
const rim = () => clock.querySelector<HTMLElement>(".cg-rim")!;
const filters = () => Array.from(clock.querySelectorAll(".cg-filters filter"));
const refraction = () => lens().style.getPropertyValue("--cg-refraction");
const frames = (n = 2) => {
  for (let i = 0; i < n; i++) vi.advanceTimersToNextFrame();
};
/** The next minute: the time changes, and the clock is drawn again. */
const minute = (text: string) => {
  time.textContent = text;
  glass.draw();
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.all = [];
  clock = document.createElement("div");
  clock.className = "h-clock";
  time = document.createElement("div");
  time.className = "t";
  time.textContent = "20:00";
  clock.append(time);
  document.body.replaceChildren(clock);
  // happy-dom lays nothing out: give the time a box, as Chromium would.
  time.getBoundingClientRect = () => new DOMRect(110, 210, 420, 200);
  glass = new ClockGlass(time, { worker: () => new FakeWorker() });
});
afterEach(() => {
  glass.dispose();
  vi.useRealTimers();
});

describe("the liquid clock's maps are built off the page", () => {
  test("a drawing hands the time's characters to a worker, at the Look's half resolution", () => {
    glass.draw();
    expect(FakeWorker.all).toHaveLength(1);
    const job = FakeWorker.all[0]!.jobs[0]!;
    expect(job.scale).toBe(GLASS.metrics.home.clockGlassMap.scale);
    expect(job.glyphs.map((g) => g.ch).join("")).toBe("20:00");
    expect(job.width).toBeGreaterThan(420);
    expect(job.height).toBeGreaterThan(200);
  });

  test("its answer points the lens at a new filter over the displacement map, and the rim at its picture", () => {
    glass.draw();
    FakeWorker.all[0]!.answer(1);
    const [filter] = filters();
    expect(refraction()).toBe(`url(#${filter!.id})`);
    expect(filter!.querySelector("feImage")!.getAttribute("href")).toBe(maps(1).displacement);
    expect(filter!.querySelector("feDisplacementMap")!.getAttribute("scale")).toBe(
      String(GLASS.metrics.home.clockGlass.refraction * designUnit(innerWidth, innerHeight)),
    );
    expect(rim().style.backgroundImage).toContain(maps(1).rim);
  });

  test("each worker is let go once it has answered", () => {
    glass.draw();
    FakeWorker.all[0]!.answer(1);
    expect(FakeWorker.all[0]!.terminated).toBe(true);
  });

  test("each minute gets a new filter id: Chromium ignores changes to a filter already in use", () => {
    glass.draw();
    FakeWorker.all[0]!.answer(1);
    const first = refraction();
    minute("20:01");
    FakeWorker.all[1]!.answer(2);
    expect(refraction()).not.toBe(first);
    expect(filters().at(-1)!.querySelector("feImage")!.getAttribute("href")).toBe(
      maps(2).displacement,
    );
  });

  test("an old filter goes once the lens has moved on, so filters don't pile up over the minutes", () => {
    for (let m = 0; m < 60; m++) {
      minute(`20:${String(m).padStart(2, "0")}`);
      FakeWorker.all.at(-1)!.answer(m);
      expect(filters().length).toBeLessThanOrEqual(2);
      frames();
      expect(filters()).toHaveLength(1);
    }
    expect(FakeWorker.all.every((w) => w.terminated)).toBe(true);
  });

  test("a minute that changes before its maps arrive drops the stale worker and shows only the newer maps", () => {
    glass.draw();
    minute("20:01");
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    FakeWorker.all[0]!.answer(1);
    expect(refraction()).toBe("");
    FakeWorker.all[1]!.answer(2);
    expect(rim().style.backgroundImage).toContain(maps(2).rim);
  });

  test("the same minute drawn again builds nothing", () => {
    glass.draw();
    glass.draw();
    expect(FakeWorker.all).toHaveLength(1);
  });

  test("the new minute's digits show together with their maps, so the old rim never sits on new digits", () => {
    glass.draw();
    FakeWorker.all[0]!.answer(1);
    const mask = lens().style.maskImage;
    expect(mask).toContain("svg");
    minute("20:01");
    expect(lens().style.maskImage).toBe(mask);
    FakeWorker.all[1]!.answer(2);
    expect(lens().style.maskImage).not.toBe(mask);
    expect(rim().style.backgroundImage).toContain(maps(2).rim);
  });

  test("disposing of the clock lets its pending worker go", () => {
    glass.draw();
    glass.dispose();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
  });

  test("Home going away lets the pending worker go at once, without waiting for its answer", async () => {
    glass.draw();
    clock.remove();
    await Promise.resolve();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
  });
});

/** Without its maps the clear glass would all but vanish, so the clock falls back to #35's frosted digits. */
describe("the liquid clock falls back to frosted digits", () => {
  const frosted = () => clock.classList.contains("cg-frosted");
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => error.mockRestore());

  test("a worker that fails is let go, and the new digits go up frosted", () => {
    glass.draw();
    FakeWorker.all[0]!.fail();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(refraction()).toBe("");
    expect(lens().style.maskImage).toContain("svg");
    expect(frosted()).toBe(true);
    expect(error).toHaveBeenCalled();
  });

  test("a worker that fails after a good minute takes the old rim and filter away", () => {
    glass.draw();
    FakeWorker.all[0]!.answer(1);
    frames();
    const mask = lens().style.maskImage;
    minute("20:01");
    FakeWorker.all[1]!.fail();
    expect(rim().style.backgroundImage).toBe("");
    expect(refraction()).toBe("");
    expect(filters()).toHaveLength(0);
    expect(lens().style.maskImage).not.toBe(mask);
    expect(frosted()).toBe(true);
  });

  test("the next minute's maps lift the frost", () => {
    glass.draw();
    FakeWorker.all[0]!.fail();
    minute("20:01");
    FakeWorker.all[1]!.answer(2);
    expect(frosted()).toBe(false);
    expect(rim().style.backgroundImage).toContain(maps(2).rim);
  });

  test("a worker that can't be started shows the frosted digits, and is tried again the next minute", () => {
    glass.dispose();
    let starts = 0;
    glass = new ClockGlass(time, {
      worker: () => {
        if (++starts === 1) throw new Error("no workers here");
        return new FakeWorker();
      },
    });
    glass.draw();
    expect(lens().style.maskImage).toContain("svg");
    expect(frosted()).toBe(true);
    minute("20:01");
    expect(FakeWorker.all).toHaveLength(1);
    FakeWorker.all[0]!.answer(1);
    expect(frosted()).toBe(false);
    expect(refraction()).not.toBe("");
  });

  test("with no Worker at all the digits are frosted", () => {
    glass.dispose();
    glass = new ClockGlass(time, { worker: () => undefined });
    glass.draw();
    expect(lens().style.maskImage).toContain("svg");
    expect(frosted()).toBe(true);
  });

  test("where backdrop-filter can't take an SVG filter, the digits are frosted and no maps are built", () => {
    glass.dispose();
    vi.stubGlobal("CSS", {
      supports: (property: string, value?: string) =>
        !(property === "backdrop-filter" && value?.startsWith("url(")),
    });
    glass = new ClockGlass(time, { worker: () => new FakeWorker() });
    glass.draw();
    vi.unstubAllGlobals();
    expect(FakeWorker.all).toHaveLength(0);
    expect(lens().style.maskImage).toContain("svg");
    expect(frosted()).toBe(true);
  });
});
