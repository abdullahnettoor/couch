import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { composeReport, playbackProbe } from "../../web/playback.ts";
import { NETFLIX_ART_PRELOAD } from "./netflix-artwork.ts";
import { netflixDescription } from "./netflix-web.ts";

const desc = netflixDescription("130.0.0.0");
const playback = desc.playback!;

/** A title card as recorded (ids and image path anonymised): a link to /browse?jbv=<id> holding the box art. */
const CARD_ART = "https://occ-0-1-1.1.nflxso.net/dnm/api/v6/AAAA/BBBB.webp?r=5f2";

function card(id: string, src: string | null = CARD_ART) {
  const img = src === null ? null : { src };
  const a: any = {
    getAttribute: (n: string) => (n === "href" ? `/browse?jbv=${id}` : null),
    querySelector: (s: string) => (s === "img" ? img : null),
  };
  const target = { closest: (s: string) => (/jbv|title|watch/.test(s) ? a : null) };
  return target;
}

/** A page that has run Netflix's preload; `click` is what the household's OK does on an element. */
function page(path = "/browse") {
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const store = new Map<string, string>();
  const sandbox: any = {
    location: { pathname: path },
    innerWidth: 1280,
    innerHeight: 720,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    document: {
      addEventListener: (t: string, h: (e: any) => void) => (listeners[t] ??= []).push(h),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    navigator: {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${NETFLIX_ART_PRELOAD.func})()`, sandbox);
  return {
    click: (target: unknown) => (listeners.click ?? []).forEach((h) => h({ target })),
    go: (p: string) => (sandbox.location.pathname = p),
    artwork: (): unknown => vm.runInContext(playback.artwork!(), sandbox),
  };
}

describe("Netflix Now Playing artwork", () => {
  test("a title played from its card shows that card's box art", () => {
    const p = page();
    p.click(card("70000001"));
    p.go("/watch/70000001");
    expect(p.artwork()).toBe(CARD_ART);
  });

  test("an episode of a show opened from its card keeps the show's box art", () => {
    const p = page();
    p.click(card("70000001"));
    p.go("/watch/70000777");
    expect(p.artwork()).toBe(CARD_ART);
  });

  test("the card that was clicked last wins, by title first", () => {
    const p = page();
    const other = "https://occ-0-2-2.1.nflxso.net/dnm/api/v6/CCCC/DDDD.webp?r=1";
    p.click(card("70000001"));
    p.click(card("70000002", other));
    p.go("/watch/70000001");
    expect(p.artwork()).toBe(CARD_ART);
    p.go("/watch/70000555");
    expect(p.artwork()).toBe(other);
  });

  test("nothing is made up: no card opened, no artwork", () => {
    const p = page("/watch/70000001");
    expect(p.artwork()).toBeFalsy();
    p.click({ closest: () => null });
    expect(p.artwork()).toBeFalsy();
  });

  test("a card with no https image gives nothing", () => {
    const p = page();
    p.click(card("70000001", "data:image/gif;base64,AAAA"));
    p.click(card("70000002", null));
    p.go("/watch/70000001");
    expect(p.artwork()).toBeFalsy();
  });

  test("it reaches the report, but only from Netflix's image hosts", async () => {
    const run = async (src: string) => {
      const sandbox: any = {
        innerWidth: 1280,
        innerHeight: 720,
        location: { pathname: "/watch/70000001" },
        sessionStorage: { getItem: () => null },
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
        k === "couchNfArt" ? JSON.stringify({ last: src, "70000001": src }) : null;
      const found = await vm.runInContext(
        playbackProbe(undefined, playback.active!(), playback.artwork!()),
        sandbox,
      );
      return composeReport(found, undefined, false, desc.artworkHosts);
    };
    expect((await run(CARD_ART))?.artwork).toBe(CARD_ART);
    expect((await run("https://tracker.example/a.jpg"))?.artwork).toBeUndefined();
  });
});
