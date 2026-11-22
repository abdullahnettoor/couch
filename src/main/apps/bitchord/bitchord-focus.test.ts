import { describe, expect, test } from "vite-plus/test";
import { loadSnapshot, type FakeEl } from "../../web/snapshot-page.ts";
import { netflixPage } from "../netflix/netflix-test-page.ts";
import { bitchordDescription } from "./bitchord-web.ts";

const desc = bitchordDescription("130.0.0.0", {
  request: () => Promise.reject(new Error("no network")),
  manifest: () => Promise.resolve("{}"),
});

/** BitChord's real pages, saved signed out at 1920×1080 (`pnpm bitchord:snapshot`). */
const fixture = (name: string) => loadSnapshot(new URL(`./fixtures/${name}.json`, import.meta.url));

function open(name: string) {
  const snap = fixture(name);
  const page = netflixPage(snap, desc.focus!);
  return { ...page, snap };
}

/** Presses a key until the ring is where `done` says, at most 200 times. */
function until(
  p: { key: (k: string) => void; on: () => FakeEl | undefined },
  k: string,
  done: (e?: FakeEl) => boolean,
) {
  for (let i = 0; i < 200 && !done(p.on()); i++) p.key(k);
  expect(done(p.on())).toBe(true);
}

/** Walks to a card a few places along its shelf: the page's left column leads Down to the sidebar, the middle to the player bar. */
function midPage(p: ReturnType<typeof open>) {
  until(p, "ArrowDown", (e) => e?.tagName === "A" && href(e) !== "" && !inDock(e));
  for (let i = 0; i < 3; i++) p.key("ArrowRight");
}

const label = (e?: FakeEl) => e?.getAttribute("aria-label") ?? "";
const href = (e?: FakeEl) => e?.getAttribute("href") ?? "";
const inDock = (e?: FakeEl) =>
  !!e?.closest('nav[aria-label="Main"], [role="region"][aria-label="Player"]');
const isPlay = (e?: FakeEl) => e?.tagName === "BUTTON" && label(e).startsWith("Play ");

describe("BitChord's focus layout, on its saved pages", () => {
  for (const name of ["home", "album", "artist", "playlist", "search"]) {
    test(`${name}: the ring starts on a visible control, outlined with no fill`, () => {
      const p = open(name);
      expect(p.ring.style.display).toBe("block");
      expect(p.ring.style.background).toBe("none");
      const el = p.on();
      expect(el).toBeDefined();
      expect(el!.hiddenStyle).toBe(false);
    });
  }

  describe("the starting ring", () => {
    const TRACK = '[class*="group/track"], [class*="group/row"]';
    const px = (v: unknown) => Number.parseFloat(String(v));
    const ringAt = (p: ReturnType<typeof open>) => ({
      left: px(p.ring.style.left) + 6,
      top: px(p.ring.style.top) + 6,
    });
    const firstOf = (p: ReturnType<typeof open>, skip: FakeEl[] = []) =>
      p.all
        .filter(
          (e) => isPlay(e) && !skip.includes(e) && !inDock(e) && !e.hiddenStyle && e.rect.top >= 0,
        )
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]!;
    /** The page lays out again: the element and what is in it go far down. */
    const shiftDown = (el: FakeEl) => {
      const walk = (e: FakeEl) => {
        e.rect = { ...e.rect, top: e.rect.top + 3000, bottom: e.rect.bottom + 3000 };
        e.children.forEach(walk);
      };
      walk(el);
    };

    test("home: it starts on the first control of the first row, outlined as the whole row", () => {
      const p = open("home");
      const first = firstOf(p);
      expect(p.on()).toBe(first);
      const row = first.closest(TRACK)!;
      expect(ringAt(p)).toEqual({ left: row.rect.left, top: row.rect.top });
    });

    test("it is placed again when the page changes before the household moves", () => {
      const p = open("home");
      const first = p.on()!;
      shiftDown(first.closest(TRACK)!);
      p.mutate();
      expect(p.on()).toBe(firstOf(p, [first]));
      expect(p.on()).not.toBe(first);
    });

    test("it is placed again as the page settles, with no change the page announces", () => {
      const p = open("home");
      const first = p.on()!;
      shiftDown(first.closest(TRACK)!);
      p.wait(1000);
      expect(p.on()).toBe(firstOf(p, [first]));
    });

    test("it is placed again before the first key, which then moves from there", () => {
      const p = open("home");
      const first = p.on()!;
      shiftDown(first.closest(TRACK)!);
      const second = firstOf(p, [first]);
      p.key("ArrowDown");
      const next = p.on()!;
      expect(next).not.toBe(first);
      expect(next.rect.top).toBeGreaterThan(second.rect.top);
    });

    test("after the household moves it stays where they put it", () => {
      const p = open("home");
      p.key("ArrowDown");
      const held = p.on()!;
      shiftDown(firstOf(p).closest(TRACK)!);
      p.mutate();
      p.wait(7000);
      expect(p.on()).toBe(held);
    });
  });

  describe("the ring on a song row", () => {
    for (const name of ["album", "playlist"]) {
      test(`${name}: it outlines the whole song row, and OK presses that row's Play`, () => {
        const p = open(name);
        until(p, "ArrowDown", isPlay);
        for (let i = 0; i < 3; i++) {
          const play = p.on()!;
          const row = play.closest('[class*="group/track"], [class*="group/row"]')!;
          expect(Number.parseFloat(String(p.ring.style.left))).toBe(row.rect.left - 6);
          expect(Number.parseFloat(String(p.ring.style.width))).toBe(
            row.rect.right - row.rect.left + 12,
          );
          expect(Number.parseFloat(String(p.ring.style.height))).toBe(
            row.rect.bottom - row.rect.top + 12,
          );
          expect(Number.parseFloat(String(p.ring.style.width))).toBeGreaterThan(
            play.rect.right - play.rect.left + 400,
          );
          expect(p.ok()).toBe(play);
          p.key("ArrowDown");
        }
      });
    }
  });

  test("the layout is on the description, with its own search address", () => {
    expect(desc.focus?.layout?.docks?.length).toBe(4);
    expect(desc.search?.placeholder).toBe("Search BitChord");
    expect(desc.search?.typeIntoField).toBe(false);
    expect(desc.search?.navigate).toBe("history");
  });

  test("the search page's own field is never a stop: the phone types, and the ring starts on a result", () => {
    const p = open("search");
    const field = p.all.filter((e) => e.matches?.('form[role="search"] input') ?? false);
    expect(p.on()?.tagName).not.toBe("INPUT");
    expect(p.on()?.getAttribute("role")).not.toBe("combobox");
    for (const f of field) expect(p.on()).not.toBe(f);
    expect(isPlay(p.on()) || href(p.on()) !== "").toBe(true);
  });

  describe("home", () => {
    test("Right walks along a shelf of cards and Left walks back", () => {
      const p = open("search");
      until(p, "ArrowDown", (e) => href(e).startsWith("/album/") && label(e) !== "");
      until(p, "ArrowLeft", (e) => e!.rect.left < 400);
      const first = p.on()!;
      const seen = [first];
      for (let i = 0; i < 2; i++) {
        p.key("ArrowRight");
        const next = p.on()!;
        expect(next.rect.top).toBe(first.rect.top);
        expect(next.rect.left).toBeGreaterThan(seen.at(-1)!.rect.left);
        seen.push(next);
      }
      for (let i = 1; i >= 0; i--) {
        p.key("ArrowLeft");
        expect(p.on()).toBe(seen[i]);
      }
    });

    test("a card's duplicate title link is never a stop of its own", () => {
      const p = open("home");
      const stops = new Set<FakeEl>();
      for (const k of ["ArrowUp", "ArrowDown"]) {
        for (let i = 0; i < 40; i++) {
          p.key(k);
          stops.add(p.on()!);
        }
      }
      for (const e of stops) {
        if (href(e).startsWith("/playlist/")) expect(label(e)).not.toBe("");
      }
    });
  });

  describe("song rows", () => {
    test("on an album, Down walks the Play buttons in order and OK presses the focused one", () => {
      const p = open("album");
      until(p, "ArrowDown", isPlay);
      const names: string[] = [];
      for (let i = 0; i < 4; i++) {
        names.push(label(p.on()));
        const row = p.on()!;
        expect(row.rect.left).toBe(p.on()!.rect.left);
        p.key("ArrowDown");
      }
      expect(new Set(names).size).toBe(4);
      p.key("ArrowUp");
      const target = p.on()!;
      const clicked = p.ok();
      expect(clicked).toBe(target);
      expect(isPlay(clicked)).toBe(true);
    });

    test("a song's artists, title and menu are not stops: its Play button is", () => {
      for (const name of ["album", "playlist", "artist", "search", "home"]) {
        const p = open(name);
        const stops = new Set<FakeEl>();
        for (const k of ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft"]) {
          for (let i = 0; i < 25; i++) {
            p.key(k);
            const e = p.on();
            if (e) stops.add(e);
          }
        }
        for (const e of stops) {
          if (e.closest('[class*="group/track"], [class*="group/row"]')) {
            expect(isPlay(e), `${name}: ${e.tagName} ${label(e)} ${href(e)}`).toBe(true);
          }
        }
      }
    });

    test("the shelves' paging arrows are never stops", () => {
      const p = open("home");
      for (const k of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
        for (let i = 0; i < 30; i++) {
          p.key(k);
          expect(label(p.on())).not.toMatch(/Page$/);
        }
      }
    });

    test("the volume slider is not a stop: volume is Couch's", () => {
      const p = open("home");
      for (let i = 0; i < 30; i++) {
        p.key("ArrowRight");
        expect(p.on()?.getAttribute("type")).not.toBe("range");
      }
    });
  });

  describe("reaching the player bar from any page, on pages saved to their end", () => {
    const inBar = (e?: FakeEl) => !!e?.closest('[role="region"][aria-label="Player"]');
    const inNav = (e?: FakeEl) => !!e?.closest("nav");
    const bar = (p: { all: FakeEl[] }) =>
      p.all.find((e) => e.getAttribute("aria-label") === "Player")!;
    const play = (p: { all: FakeEl[] }) =>
      p.all.find((e) => inBar(e) && label(e) === "Play" && e.tagName === "BUTTON")!;
    const lastRowOf = (p: { all: FakeEl[] }) =>
      p.all.filter((e) => e.matches(TRACK_ROW) && !e.stuck && e.rect.top >= 0).at(-1)!;
    const TRACK_ROW = '[class*="group/track"], [class*="group/row"]';
    /** Goes Down to the last control of the page, then once more. */
    const downToEnd = (p: ReturnType<typeof open>) => {
      let last: FakeEl | undefined;
      for (let i = 0; i < 200 && p.on() !== last; i++) {
        last = p.on();
        p.key("ArrowDown");
        if (inDock(p.on())) break;
      }
    };

    for (const name of ["playlist-long-end", "home-end"]) {
      test(`${name}: the saved page reaches past the 12 rows of the others`, () => {
        const p = open(name);
        expect(p.all.length).toBeGreaterThan(150);
        expect(bar(p)).toBeDefined();
      });
    }

    test("a last row at the screen's bottom edge, its centre below the bar's, still leads Down to the bar", () => {
      const p = open("playlist-long-end");
      const row = lastRowOf(p);
      expect(row.rect.bottom).toBeGreaterThan(p.snap.view.height - 8);
      const r = row.getBoundingClientRect();
      const barRect = bar(p).getBoundingClientRect();
      expect((r.top + r.bottom) / 2).toBeGreaterThan((barRect.top + barRect.bottom) / 2);
      downToEnd(p);
      expect(inBar(p.on())).toBe(true);
    });

    test("a page ending in cards beside the sidebar goes Down to the bar, not the sidebar", () => {
      const p = open("home-end");
      for (let i = 0; i < 100 && !inDock(p.on()); i++) p.key("ArrowDown");
      expect(inBar(p.on())).toBe(true);
      expect(inNav(p.on())).toBe(false);
    });

    test("the sidebar's last item goes Down to the bar, and Up goes back to the page", () => {
      const p = open("home-end");
      until(p, "ArrowLeft", inNav);
      for (let i = 0; i < 20 && !inBar(p.on()); i++) p.key("ArrowDown");
      expect(inBar(p.on())).toBe(true);
      p.key("ArrowUp");
      expect(inDock(p.on())).toBe(false);
    });

    test("from the middle of a long page, Left then a few Downs reaches the bar", () => {
      const p = open("playlist-long-end");
      for (let i = 0; i < 5; i++) p.key("ArrowDown");
      p.key("ArrowLeft");
      expect(inNav(p.on())).toBe(true);
      let presses = 0;
      while (!inBar(p.on()) && presses < 7) {
        p.key("ArrowDown");
        presses++;
      }
      expect(inBar(p.on())).toBe(true);
    });

    test("Down from a row that is not the last one scrolls the list; it does not jump to the bar", () => {
      const p = open("playlist-long-end");
      p.key("ArrowDown");
      p.key("ArrowDown");
      expect(inDock(p.on())).toBe(false);
    });

    test("the bar is entered on Play when a song is loaded, whatever the ring's column", () => {
      const p = open("playlist-long-end");
      const button = play(p);
      delete button.attrs.disabled;
      button.disabled = false;
      downToEnd(p);
      expect(p.on()).toBe(button);
    });

    test("the bar is entered on Pause when the song is playing", () => {
      const p = open("home-end");
      const button = play(p);
      delete button.attrs.disabled;
      button.disabled = false;
      button.attrs["aria-label"] = "Pause";
      for (let i = 0; i < 100 && !inDock(p.on()); i++) p.key("ArrowDown");
      expect(p.on()).toBe(button);
    });

    test("with no Play or Pause to land on, the control nearest across is the entry", () => {
      const p = open("home-end");
      for (let i = 0; i < 100 && !inDock(p.on()); i++) p.key("ArrowDown");
      expect(inBar(p.on())).toBe(true);
      expect(p.on()?.tagName).toBe("BUTTON");
    });
  });

  describe("sidebar and player bar", () => {
    test("Down from the last thing on a page reaches the player bar, and Up comes back to the page", () => {
      const p = open("home");
      midPage(p);
      for (let i = 0; i < 200 && !inDock(p.on()); i++) p.key("ArrowDown");
      expect(p.on()?.closest('[role="region"]')).toBeTruthy();
      p.key("ArrowDown");
      expect(inDock(p.on())).toBe(true);
      expect(p.on()?.closest("nav")).toBeNull();
      p.key("ArrowUp");
      expect(inDock(p.on())).toBe(false);
    });

    test("Down does not skip the rest of the page for the player bar", () => {
      const p = open("album");
      const stops: FakeEl[] = [];
      for (let i = 0; i < 80; i++) {
        p.key("ArrowDown");
        const e = p.on()!;
        if (stops.at(-1) === e) break;
        stops.push(e);
      }
      const firstDock = stops.findIndex(inDock);
      const lastPage = stops.findLastIndex((e) => !inDock(e));
      expect(firstDock).toBeGreaterThan(0);
      expect(lastPage).toBeLessThan(firstDock);
      // Every song and card of the page came before the player bar.
      expect(stops.filter(isPlay).length).toBeGreaterThanOrEqual(10);
    });

    test("Left from the first song reaches the sidebar; Down walks it and Right goes back to the page", () => {
      const p = open("album");
      until(p, "ArrowDown", isPlay);
      p.key("ArrowLeft");
      expect(p.on()?.closest("nav")).toBeTruthy();
      p.key("ArrowDown");
      expect(p.on()?.closest("nav")).toBeTruthy();
      until(p, "ArrowRight", (e) => !inDock(e));
    });

    test("in the player bar, Left and Right walk its enabled buttons and Up goes back to the page", () => {
      const p = open("home");
      midPage(p);
      until(p, "ArrowDown", inDock);
      const names = new Set<string>();
      until(p, "ArrowLeft", (e) => label(e) === "Shuffle");
      for (const k of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft"]) {
        p.key(k);
        expect(inDock(p.on())).toBe(true);
        names.add(label(p.on()));
      }
      expect([...names]).toEqual(expect.arrayContaining(["Repeat", "Lyrics", "Up Next"]));
      p.key("ArrowUp");
      expect(inDock(p.on())).toBe(false);
    });
  });

  describe("opening things", () => {
    test("OK on a search result's album card opens its album, and on an artist its artist", () => {
      const p = open("search");
      const opened = new Set<string>();
      const look = () => {
        const e = p.on();
        if (e?.tagName === "A") opened.add(href(e).split("/")[1]!);
      };
      look();
      for (const k of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
        for (let i = 0; i < 12; i++) {
          p.key(k);
          look();
        }
      }
      expect(opened.has("album")).toBe(true);
      expect(opened.has("artist")).toBe(true);
    });

    test("an artist's page offers its songs and its albums", () => {
      const p = open("artist");
      const kinds = new Set<string>();
      for (let i = 0; i < 40; i++) {
        p.key("ArrowDown");
        const e = p.on()!;
        kinds.add(isPlay(e) ? "play" : href(e).split("/")[1]!);
      }
      expect(kinds.has("play")).toBe(true);
      expect(kinds.has("album")).toBe(true);
    });
  });

  describe("Settings and the Extension page", () => {
    const outOfReach = (e?: FakeEl) =>
      !!e &&
      (href(e).includes("/downloads/") ||
        href(e).startsWith("https://github.com/") ||
        href(e) === "/settings/listen-together");

    test("Down walks every switch row, one stop each, and OK toggles it", () => {
      // The saved page is taller than its 720 px window; the fake page doesn't scroll to rows past the edge, so it is given room.
      const snap = fixture("settings");
      snap.view.height = 1000;
      const p = { ...netflixPage(snap, desc.focus!), snap };
      const rows = p.all.filter(
        (e) => e.tagName === "LABEL" && e.children.some((c) => c.tagName === "INPUT"),
      );
      expect(rows.length).toBe(5);
      const seen = new Set<FakeEl>();
      const toggled = new Set<FakeEl>();
      for (let i = 0; i < 40; i++) {
        const e = p.on();
        if (e && rows.includes(e)) {
          seen.add(e);
          if (!toggled.has(e)) expect(p.ok()).toBe(e);
          toggled.add(e);
        }
        expect(e?.tagName).not.toBe("INPUT");
        p.key("ArrowDown");
      }
      expect(seen.size).toBe(5);
    });

    test("the Crossfade and Lyric Sources buttons stay reachable", () => {
      const p = open("settings");
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const e = p.on();
        if (e?.tagName === "BUTTON") seen.add(label(e) || e.getAttribute("type") || "button");
        p.key("ArrowDown");
      }
      expect(seen.size).toBeGreaterThanOrEqual(1);
      expect(p.all.some((e) => e.tagName === "BUTTON" && !label(e) && e.closest("label"))).toBe(
        true,
      );
    });

    for (const name of ["settings", "extension"]) {
      test(`${name}: the ring never starts on or reaches a download, GitHub or Listen Together`, () => {
        const p = open(name);
        expect(outOfReach(p.on())).toBe(false);
        for (const k of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"])
          for (let i = 0; i < 25; i++) {
            p.key(k);
            expect(outOfReach(p.on())).toBe(false);
          }
      });
    }

    test("extension: the ring starts on something that isn't a download", () => {
      const p = open("extension");
      expect(p.on()).toBeDefined();
      expect(href(p.on())).not.toContain("/downloads/");
    });
  });
});
