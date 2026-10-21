import { describe, expect, test } from "vite-plus/test";
import { fakePage } from "../../../web/page-test-helpers.ts";
import { ADBLOCK } from "./adblock.ts";
import browse from "./fixtures/browse.json" with { type: "json" };
import player from "./fixtures/player.json" with { type: "json" };
import search from "./fixtures/search.json" with { type: "json" };
import shorts from "./fixtures/shorts.json" with { type: "json" };

function page(body = "{}") {
  return fakePage(body, [ADBLOCK.page]).run;
}

const parse = (run: (s: string) => any, v: unknown) =>
  run(`JSON.parse(${JSON.stringify(JSON.stringify(v))})`);
const clone = <T>(v: T): any => JSON.parse(JSON.stringify(v));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

async function fetched(url: string, v: unknown) {
  const run = page(JSON.stringify(v));
  const res = await run(`fetch(${JSON.stringify(url)})`);
  return JSON.parse(await res.text());
}

describe("ad blocker add-on", () => {
  test("is off by default", () => {
    expect(ADBLOCK).toMatchObject({ id: "adblock", label: "Ad blocker", defaultOn: false });
  });

  test("player response: ad lists emptied, everything else unchanged", () => {
    const want = clone(player);
    want.adPlacements = [];
    want.adSlots = [];
    want.playerAds = [];
    expect(plain(parse(page(), player))).toEqual(want);
  });

  test("Shorts sequence: only ad entries dropped", () => {
    const want = clone(shorts);
    want.entries = [shorts.entries[0], shorts.entries[2]];
    expect(plain(parse(page(), shorts))).toEqual(want);
  });

  test("home browse: ad, promo and premium shelves and inline ad tiles removed", async () => {
    const want = clone(browse);
    const list =
      want.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer;
    list.contents = [list.contents[3]];
    list.contents[0].shelfRenderer.content.horizontalListRenderer.items = [
      { tileRenderer: { contentId: "v1" } },
      { tileRenderer: { contentId: "v2" } },
    ];
    expect(await fetched("/youtubei/v1/browse?prettyPrint=false", browse)).toEqual(want);
  });

  test("search: ad tiles and ad sections removed", async () => {
    const want = clone(search);
    want.contents.sectionListRenderer.contents = [want.contents.sectionListRenderer.contents[0]];
    want.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items =
      [{ tileRenderer: { contentId: "s1" } }, { tileRenderer: { contentId: "s2" } }];
    expect(await fetched("https://www.youtube.com/youtubei/v1/search", search)).toEqual(want);
  });

  test("other endpoints and responses without ads are left alone", async () => {
    expect(await fetched("/youtubei/v1/next", browse)).toEqual(browse);
    const clean = { contents: { sectionListRenderer: { contents: [{ shelfRenderer: {} }] } } };
    expect(await fetched("/youtubei/v1/search", clean)).toEqual(clean);
  });

  test("a feed that is not valid JSON passes through untouched and is not reported as a failure", async () => {
    const bad = '{"adSlotRenderer": nope';
    const p = fakePage(bad, [ADBLOCK.page]);
    const res = await p.run('fetch("/youtubei/v1/browse")');
    expect(await res.text()).toBe(bad);
    expect(p.logs).toEqual([]);
  });
});
