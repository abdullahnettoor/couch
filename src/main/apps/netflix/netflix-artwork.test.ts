import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { composeReport, playbackProbe } from "../../web/playback.ts";
import { NETFLIX_ART_PRELOAD } from "./netflix-artwork.ts";
import { netflixDescription } from "./netflix-web.ts";

const desc = netflixDescription("130.0.0.0");
const playback = desc.playback!;

/** Box art as the page names it (ids and image paths anonymised). */
const CARD_ART = "https://occ-0-1-1.1.nflxso.net/dnm/api/v6/AAAA/BBBB.webp?r=5f2";
const OTHER_ART = "https://occ-0-2-2.1.nflxso.net/dnm/api/v6/CCCC/DDDD.webp?r=1";
const BILLBOARD_ART = "https://occ-0-3-3.1.nflxso.net/dnm/api/v6/EEEE/FFFF.webp?r=9";

/** One element of a recorded page: `closest` understands the attribute selectors the preload asks. */
class El {
  children: El[] = [];
  attrs: Record<string, string>;
  parent: El | undefined;
  src: string | undefined;
  text = "";
  constructor(attrs: Record<string, string> = {}, parent?: El, src?: string) {
    this.attrs = attrs;
    this.parent = parent;
    this.src = src;
    parent?.children.push(this);
  }
  #matches(sel: string): boolean {
    return sel.split(",").some((part) => {
      const m = /^\s*\[([\w-]+)="([^"]*)"\]\s*$/.exec(part);
      if (m) return this.attrs[m[1]!] === m[2];
      const l = /^\s*a\[href\*="([^"]*)"\]\s*$/.exec(part);
      return !!l && (this.attrs.href ?? "").includes(l[1]!);
    });
  }
  get textContent(): string {
    return this.text || this.children.map((c) => c.textContent).join(" ");
  }
  all(sel: string): El[] {
    return this.children.flatMap((c) => [...(c.#matches(sel) ? [c] : []), ...c.all(sel)]);
  }
  closest(sel: string): El | null {
    return this.#matches(sel) ? this : (this.parent?.closest(sel) ?? null);
  }
  getAttribute(n: string) {
    return this.attrs[n] ?? null;
  }
  #images(): El[] {
    return this.children.flatMap((c) => (c.src ? [c, ...c.#images()] : c.#images()));
  }
  querySelector(sel: string) {
    return sel === "img" ? (this.#images()[0] ?? null) : null;
  }
  querySelectorAll(sel: string) {
    return sel === "img" ? this.#images() : [];
  }
  getBoundingClientRect() {
    return { width: this.attrs.big ? 1000 : 100, height: this.attrs.big ? 500 : 50 };
  }
}

const root = () => new El();
function card(id: string, art: string | null = CARD_ART, parent = root()) {
  const a = new El({ href: `/browse?jbv=${id}` }, parent);
  if (art) new El({}, a, art);
  return a;
}
function popup() {
  return new El({ role: "dialog" }, root());
}
function episode(id: string, parent: El) {
  return new El({ href: `/watch/${id}` }, parent);
}
function billboardPlay() {
  const board = new El({ "data-uia": "billboard" }, root());
  new El({}, board, "https://occ-0-3-3.1.nflxso.net/logo.png");
  new El({ big: "1" }, board, BILLBOARD_ART);
  return new El({ "data-uia": "play-video-button" }, new El({}, board));
}

/** A page that has run Netflix's preload; `click` is what the household's OK does on an element. */
function page(path = "/browse") {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const store = new Map<string, string>();
  const body = new El();
  const timers: (() => void)[] = [];
  const sandbox: any = {
    setInterval: (f: () => void) => timers.push(f),
    location: { pathname: path },
    innerWidth: 1280,
    innerHeight: 720,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    document: {
      addEventListener: (t: string, h: (e: any) => void) => (listeners[t] ??= []).push(h),
      querySelector: (sel: string) => body.all(sel)[0] ?? null,
      querySelectorAll: (sel: string) => body.all(sel),
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${NETFLIX_ART_PRELOAD.func})()`, sandbox);
  return {
    click: (target: unknown) => (listeners.click ?? []).forEach((h) => h({ target })),
    go: (p: string) => (sandbox.location.pathname = p),
    /** Puts an element on the page (a card in a row, the player's header). */
    show: (el: El) => void body.children.push(el),
    /** Clears the page, as Netflix's route change does. */
    clear: () => void (body.children.length = 0),
    tick: () => timers.forEach((f) => f()),
    artwork: (): unknown => vm.runInContext(playback.artwork!(), sandbox),
    title: (): unknown => vm.runInContext(playback.title!(), sandbox),
  };
}

describe("Netflix Now Playing artwork", () => {
  test("a title played from its card shows that card's box art", () => {
    const p = page();
    p.click(card("70000001"));
    p.go("/watch/70000001");
    expect(p.artwork()).toBe(CARD_ART);
  });

  test("a title started from the billboard shows the billboard's image", () => {
    const p = page();
    p.click(billboardPlay());
    p.go("/watch/70000009");
    expect(p.artwork()).toBe(BILLBOARD_ART);
  });

  test("an episode played inside a series' pop-up shows the series' box art", () => {
    const p = page();
    p.click(card("70000001"));
    const pop = popup();
    p.click(episode("70000777", pop));
    p.go("/watch/70000777");
    expect(p.artwork()).toBe(CARD_ART);
  });

  test("the pop-up's own Play button shows the card's art for the title it opens", () => {
    const p = page();
    p.click(card("70000001"));
    p.click(new El({ "data-uia": "play-video-button" }, popup()));
    p.go("/watch/70000555");
    expect(p.artwork()).toBe(CARD_ART);
  });

  test("a title that no click leads to gets no artwork, not the last card's", () => {
    const p = page();
    p.click(card("70000001"));
    p.click(card("70000002", OTHER_ART));
    p.go("/watch/70000555");
    expect(p.artwork()).toBeFalsy();
    p.go("/watch/70000002");
    expect(p.artwork()).toBe(OTHER_ART);
  });

  test("a pop-up closed by a click elsewhere does not lend its art to a later episode link", () => {
    const p = page();
    p.click(card("70000001"));
    p.click(new El({}, root()));
    p.click(episode("70000777", root()));
    p.go("/watch/70000777");
    expect(p.artwork()).toBeFalsy();
  });

  test("nothing is made up: no card opened, no artwork", () => {
    const p = page("/watch/70000001");
    expect(p.artwork()).toBeFalsy();
    p.click(new El());
    expect(p.artwork()).toBeFalsy();
  });

  test("a card with no https image gives nothing", () => {
    const p = page();
    p.click(card("70000001", "data:image/gif;base64,AAAA"));
    p.click(card("70000002", null));
    p.go("/watch/70000001");
    expect(p.artwork()).toBeFalsy();
    p.go("/watch/70000002");
    expect(p.artwork()).toBeFalsy();
  });

  test("it reaches the report, but only from Netflix's image hosts", async () => {
    const run = async (src: string) => {
      const sandbox: any = {
        innerWidth: 1280,
        innerHeight: 720,
        location: { pathname: "/watch/70000001" },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: {
          querySelectorAll: () => [
            {
              readyState: 4,
              duration: 100,
              currentTime: 5,
              paused: false,
              getBoundingClientRect: () => ({ width: 1280, height: 720 }),
            },
          ],
        },
        navigator: {},
      };
      sandbox.window = sandbox;
      vm.createContext(sandbox);
      sandbox.sessionStorage.getItem = (k: string) =>
        k === "couchNfArt" ? JSON.stringify({ "70000001": src }) : null;
      const found = await vm.runInContext(
        playbackProbe({ active: playback.active!(), artwork: playback.artwork!() }),
        sandbox,
      );
      return composeReport(found, undefined, false, desc.artworkHosts);
    };
    expect((await run(CARD_ART))?.artwork).toBe(CARD_ART);
    expect((await run("https://tracker.example/a.jpg"))?.artwork).toBeUndefined();
  });

  describe("a title started without a click", () => {
    test("a card the page showed gives its art when the title is played by a key", () => {
      const p = page();
      p.show(card("70000001"));
      p.tick();
      p.clear();
      p.go("/watch/70000001");
      expect(p.artwork()).toBe(CARD_ART);
    });

    test("a card that was never shown for that title gives nothing", () => {
      const p = page();
      p.show(card("70000001"));
      p.tick();
      p.clear();
      p.go("/watch/70000555");
      expect(p.artwork()).toBeFalsy();
    });
  });

  describe("the next episode autoplays", () => {
    const header = (...parts: string[]) => {
      const h = new El({ "data-uia": "video-title" });
      for (const t of parts) {
        const c = new El({}, h);
        c.text = t;
      }
      return h;
    };

    test("it keeps the series' art when the header names the same series", () => {
      const p = page();
      p.click(card("70000001"));
      p.click(episode("70000100", popup()));
      p.go("/watch/70000100");
      p.show(header("Some Show", "S1:E1", "Pilot"));
      expect(p.artwork()).toBe(CARD_ART);
      p.clear();
      p.go("/watch/70000101");
      p.show(header("Some Show", "S1:E2", "Second"));
      expect(p.artwork()).toBe(CARD_ART);
    });

    test("a different title that follows does not borrow the art", () => {
      const p = page();
      p.click(card("70000001"));
      p.click(episode("70000100", popup()));
      p.go("/watch/70000100");
      p.show(header("Some Show", "S1:E1", "Pilot"));
      expect(p.artwork()).toBe(CARD_ART);
      p.clear();
      p.go("/watch/70000900");
      p.show(header("Another Show", "S1:E1", "Pilot"));
      expect(p.artwork()).toBeFalsy();
    });

    test("without a header there is no proof of the same series, so no art", () => {
      const p = page();
      p.click(card("70000001"));
      p.click(episode("70000100", popup()));
      p.go("/watch/70000100");
      expect(p.artwork()).toBe(CARD_ART);
      p.go("/watch/70000101");
      expect(p.artwork()).toBeFalsy();
    });
  });

  describe("the title from the player's header", () => {
    const header = (...parts: string[]) => {
      const h = new El({ "data-uia": "video-title" });
      for (const t of parts) {
        const c = new El({}, h);
        c.text = t;
      }
      return h;
    };

    test("a series reads as its name, season and episode, and episode title", () => {
      const p = page("/watch/70000100");
      p.show(header("Some Show", "S1:E2", "Second"));
      expect(p.title()).toBe("Some Show \u00b7 S1:E2 \u00b7 Second");
    });

    test("a film reads as its name", () => {
      const p = page("/watch/70000100");
      p.show(header("A Film"));
      expect(p.title()).toBe("A Film");
    });

    test("it is remembered while Netflix hides the bar, and not lent to another title", () => {
      const p = page("/watch/70000100");
      p.show(header("A Film"));
      expect(p.title()).toBe("A Film");
      p.clear();
      expect(p.title()).toBe("A Film");
      p.go("/watch/70000200");
      expect(p.title()).toBeFalsy();
    });

    test("nothing off the player", () => {
      const p = page("/browse");
      p.show(header("A Film"));
      expect(p.title()).toBeFalsy();
    });
  });

  test("the report takes the header's title when the media session has none, and the media session's when it has", async () => {
    const run = async (metadata: unknown) => {
      const sandbox: any = {
        innerWidth: 1280,
        innerHeight: 720,
        location: { pathname: "/watch/70000001" },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: {
          querySelectorAll: () => [
            {
              readyState: 4,
              duration: 100,
              currentTime: 5,
              paused: false,
              getBoundingClientRect: () => ({ width: 1280, height: 720 }),
            },
          ],
          querySelector: () => ({ children: [], textContent: " A  Film " }),
        },
        navigator: { mediaSession: { metadata } },
      };
      sandbox.window = sandbox;
      vm.createContext(sandbox);
      const found = await vm.runInContext(
        playbackProbe({ active: playback.active!(), title: playback.title!() }),
        sandbox,
      );
      return composeReport(found, undefined, false, desc.artworkHosts);
    };
    expect((await run(null))?.title).toBe("A Film");
    expect((await run({ title: "Session title", artwork: [] }))?.title).toBe("Session title");
  });
});
