import { describe, expect, test } from "vite-plus/test";
import { loadSnapshot, type FakeEl } from "../../web/snapshot-page.ts";
import { connect, netflixPage } from "../netflix/netflix-test-page.ts";
import { backAction, BACK_QUERY } from "../../web/page-focus.ts";
import { bitchordDescription } from "./bitchord-web.ts";

const desc = bitchordDescription("130.0.0.0", {
  request: () => Promise.reject(new Error("no network")),
  manifest: () => Promise.resolve("{}"),
});

/** BitChord's Lyrics and Up Next side panels, saved signed out with a song playing and the panel open (`pnpm bitchord:snapshot`). */
const fixture = (name: string) => loadSnapshot(new URL(`./fixtures/${name}.json`, import.meta.url));

type Page = ReturnType<typeof netflixPage>;
const BAR = '[role="region"][aria-label="Player"]';
const label = (e?: FakeEl) => e?.getAttribute("aria-label") ?? "";
const open = (name: string) => netflixPage(fixture(name), desc.focus!);
const panelOf = (p: Page, name: string) =>
  p.all.find((e) => e.tagName.toLowerCase() === "aside" && label(e) === name)!;
const inPanel = (e?: FakeEl) => !!e?.closest("aside");
const back = (p: Page) => backAction(p.run(BACK_QUERY));
const px = (v: unknown) => Number.parseFloat(String(v));
const toggle = (p: Page, name: string) => p.all.find((e) => e.closest(BAR) && label(e) === name)!;

/** Presses a key until the ring is in the panel, at most 40 times. */
function until(p: Page, key: string, done: () => boolean) {
  for (let i = 0; i < 40 && !done(); i++) p.key(key);
  return done();
}

describe.each([
  ["Lyrics", "lyrics-panel"],
  ["Up Next", "queue-panel"],
])("BitChord's %s panel, from the Remote", (name, file) => {
  test("Right from the page reaches the panel", () => {
    const p = open(file);
    expect(inPanel(p.on())).toBe(false);
    expect(until(p, "ArrowRight", () => inPanel(p.on()))).toBe(true);
  });

  test("Right then Left comes back to the page, never to its far left", () => {
    const p = open(file);
    until(p, "ArrowRight", () => inPanel(p.on()));
    const before = p.on()!;
    p.key("ArrowLeft");
    const page = p.on()!;
    expect(inPanel(page)).toBe(false);
    p.key("ArrowRight");
    expect(inPanel(p.on())).toBe(true);
    expect(before).toBeTruthy();
    expect(page.rect.right).toBeGreaterThan(300);
  });

  test("Right from a control in the panel stays on it: no jump to the page's left side", () => {
    const p = open(file);
    until(p, "ArrowRight", () => inPanel(p.on()));
    for (let i = 0; i < 6; i++) {
      const held = p.on();
      p.key("ArrowRight");
      const now = p.on();
      expect(inPanel(now)).toBe(true);
      if (now !== held) expect(now!.rect.left).toBeGreaterThan(held!.rect.left);
    }
  });

  test("rows under the panel are outlined only up to its edge", () => {
    const p = open(file);
    const edge = panelOf(p, name).rect.left;
    for (let i = 0; i < 30; i++) {
      p.key(i % 3 === 0 ? "ArrowDown" : "ArrowRight");
      if (p.ring.style.display === "block" && !inPanel(p.on()) && p.on()!.rect.bottom < 600) {
        expect(
          px(p.ring.style.left) + px(p.ring.style.width) - 6,
          `${p.on()!.tagName} ${label(p.on())} ${JSON.stringify(p.on()!.rect)} ${p.ring.style.left} ${p.ring.style.width}`,
        ).toBeLessThanOrEqual(edge + 0.5);
      }
    }
  });

  test("Back closes the panel by its bar toggle, and the next Back goes back a page", () => {
    const p = open(file);
    const toggleEl = toggle(p, name);
    expect(back(p)).toBe("none");
    expect(toggleEl.clicks).toBe(1);
    connect(panelOf(p, name), false);
    p.mutate();
    expect(back(p)).toBe("history");
    expect(toggleEl.clicks).toBe(1);
  });

  test("Back with a disabled toggle doesn't count as closed: it goes back a page", () => {
    const p = open(file);
    const toggleEl = toggle(p, name);
    toggleEl.attrs.disabled = "";
    toggleEl.disabled = true;
    expect(back(p)).toBe("history");
    expect(toggleEl.clicks).toBe(0);
  });

  test("Back doesn't count an aria-disabled toggle either", () => {
    const p = open(file);
    const toggleEl = toggle(p, name);
    toggleEl.attrs["aria-disabled"] = "true";
    expect(back(p)).toBe("history");
    expect(toggleEl.clicks).toBe(0);
  });

  test("Back with the ring in the panel closes it as well", () => {
    const p = open(file);
    until(p, "ArrowRight", () => inPanel(p.on()));
    expect(back(p)).toBe("none");
    expect(toggle(p, name).clicks).toBe(1);
  });
});

describe("Up Next", () => {
  test("OK on a queued song plays it", () => {
    const p = open("queue-panel");
    expect(until(p, "ArrowRight", () => inPanel(p.on()))).toBe(true);
    expect(until(p, "ArrowDown", () => label(p.on()).startsWith("Play ") && inPanel(p.on()))).toBe(
      true,
    );
    const clicked = p.ok();
    expect(label(clicked)).toMatch(/^Play /);
    expect(inPanel(clicked)).toBe(true);
  });

  test("its controls (AutoPlay, Playback options) are walkable", () => {
    const p = open("queue-panel");
    until(p, "ArrowRight", () => inPanel(p.on()));
    const seen = new Set<string>();
    for (const k of ["ArrowUp", "ArrowUp", "ArrowUp", "ArrowRight", "ArrowLeft"])
      for (let i = 0; i < 1; i++) {
        p.key(k);
        if (inPanel(p.on())) seen.add(label(p.on()));
      }
    expect(seen.has("AutoPlay")).toBe(true);
    expect(seen.has("Playback options")).toBe(true);
  });
});

describe("Lyrics", () => {
  test("its provider and Lyric settings are walkable", () => {
    const p = open("lyrics-panel");
    until(p, "ArrowRight", () => inPanel(p.on()));
    const seen = new Set<string>();
    for (const k of ["ArrowRight", "ArrowLeft"]) {
      p.key(k);
      if (inPanel(p.on())) seen.add(label(p.on()) || p.on()!.getAttribute("aria-haspopup") || "");
    }
    expect(seen.has("Lyric settings")).toBe(true);
    expect(seen.has("menu")).toBe(true);
  });
});
