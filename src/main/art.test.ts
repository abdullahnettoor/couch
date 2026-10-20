import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;

const ep = (n: number) => join(root, "Arcane", "Season 1", `Arcane S01E0${n}.mkv`);
const sing = () => join(root, "Sing", "Sing (2016)", "Sing.2016.mkv");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-art-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-artstore-"));
  mkdirSync(join(root, "Arcane", "Season 1"), { recursive: true });
  for (const n of [1, 2, 3]) writeFileSync(ep(n), "");
  mkdirSync(join(root, "Sing", "Sing (2016)"), { recursive: true });
  writeFileSync(sing(), "");
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

async function start(opts: { key?: boolean; watched?: boolean; ongoing?: boolean } = {}) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  if (opts.watched) {
    store.write("history", {
      items: { [ep(1)]: { duration: 2400, watched: true, at: 10 } },
    });
  }
  h = await startHarness(store, opts.key ? { tmdbProjectKey: "eyJ.test.key" } : undefined);
  h.metadata.catalog.show.arcane = [
    { id: 94605, name: "Arcane", year: 2021, overview: "Piltover.", posterPath: "/arcane.jpg" },
  ];
  h.metadata.catalog.film.sing = [
    { id: 335797, name: "Sing", year: 2016, overview: "Koala.", posterPath: "/sing.jpg" },
  ];
  h.metadata.detailsById.set(94605, {
    id: 94605,
    name: "Arcane",
    year: 2021,
    endYear: 2024,
    ...(opts.ongoing ? { ongoing: true } : {}),
    overview: "Piltover.",
    posterPath: "/arcane.jpg",
    backdropPath: "/arcane-bd.jpg",
    seasons: [
      {
        number: 1,
        episodes: [1, 2, 3].map((n) => ({
          number: n,
          name: `Name ${n}`,
          overview: `About ${n}`,
          stillPath: `/still${n}.jpg`,
        })),
      },
    ],
  });
  h.metadata.detailsById.set(335797, {
    id: 335797,
    name: "Sing",
    year: 2017,
    overview: "Koala.",
    posterPath: "/sing.jpg",
    seasons: [],
  });
  await h.app.core.library.settled();
  await h.app.core.details.settled();
  phone = await h.connectPhone();
  await phone.press("home");
  await focusId("library");
  await phone.press("ok");
}

const screen = () => h.screen.last;
const focusedId = () => screen().focusedId;
async function focusId(id: string) {
  for (let i = 0; i < 80 && focusedId() !== id; i++) {
    const { grid } = screen();
    const cur = grid.find((x) => x.id === focusedId())!;
    const t = grid.find((x) => x.id === id)!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(focusedId()).toBe(id);
}
const row = (id: string) => screen().library!.rows!.find((r) => r.id === id)!;
const tile = (id: string, key: string) => row(id).entries.find((e) => e.id === `${id}:${key}`)!;

describe("TMDB art in payloads", () => {
  test("posters, backdrops, overviews and stills when details exist", async () => {
    await start({ key: true, watched: true });
    const arcane = tile("shows", "show:arcane");
    expect(arcane.thumb).toBe("file:///tmdb/poster/arcane.jpg");
    expect(arcane.feature).toMatchObject({
      overview: "Piltover.",
      backdrop: "file:///tmdb/backdrop/arcane-bd.jpg",
    });
    expect(tile("films", sing()).thumb).toBe("file:///tmdb/poster/sing.jpg");
    expect(tile("films", sing()).feature?.overview).toBe("Koala.");
    const next = row("nextup").entries[0]!;
    expect(next.thumb).toBe("file:///tmdb/still/still2.jpg");
    expect(next.title).toBe("Name 2");
    expect(tile("recent", "show:arcane").thumb).toBe("file:///tmdb/backdrop/arcane-bd.jpg");
  });

  test("years: a show's range and a film's TMDB year beat the folder's", async () => {
    await start({ key: true });
    expect(tile("shows", "show:arcane").feature?.sub).toBe("2021–2024 · 1 season");
    expect(tile("films", sing()).feature?.sub).toBe("2017");
    await focusId("shows:show:arcane");
    await phone.press("ok");
    expect(screen().show!.meta).toEqual(["2021–2024", "1 season", "3 episodes"]);
  });

  test("years: a running show's range is open", async () => {
    await start({ key: true, ongoing: true });
    expect(tile("shows", "show:arcane").feature?.sub).toBe("2021– · 1 season");
  });

  test("years: without details the folder's year is used", async () => {
    await start();
    expect(tile("films", sing()).feature?.sub).toBe("2016");
  });

  test("show page: poster, overview, backdrop, episode names, overviews and stills", async () => {
    await start({ key: true });
    await focusId("shows:show:arcane");
    await phone.press("ok");
    const page = screen().show!;
    expect(page).toMatchObject({
      poster: "file:///tmdb/poster/arcane.jpg",
      overview: "Piltover.",
      backdrop: "file:///tmdb/backdrop/arcane-bd.jpg",
    });
    expect(page.episodes[0]).toMatchObject({
      title: "Name 1",
      overview: "About 1",
      thumb: "file:///tmdb/still/still1.jpg",
    });
  });

  test("player: the TMDB episode name is the title; Up next uses stills", async () => {
    await start({ key: true });
    await focusId("shows:show:arcane");
    await phone.press("ok");
    await phone.press("ok");
    const overlay = screen().overlay!;
    expect(overlay.title).toBe("Name 1");
    expect(phone.last!.nowPlaying!.title).toBe("Name 1");
    await phone.press("playUpNext");
    expect(h.screen.last.state.player!.path).toBe(ep(1));
    expect(phone.last!.upNext![0]!.thumbKey).toBe("still1");
  });

  test("frames fallback when there are no details", async () => {
    await start({ key: false });
    const arcane = tile("shows", "show:arcane");
    expect(arcane.thumb ?? "").not.toContain("tmdb");
    expect(arcane.feature?.overview).toBeUndefined();
    await focusId("shows:show:arcane");
    await phone.press("ok");
    const page = screen().show!;
    expect(page.poster).toBeUndefined();
    expect(page.overview).toBeUndefined();
    expect(page.episodes[0]!.title).not.toMatch(/^Name/);
    expect(page.episodes[0]!.overview).toBeUndefined();
  });

  test("focus does not move when art arrives", async () => {
    await start({ key: false });
    await focusId(`films:${sing()}`);
    const before = screen().focusedId;
    expect(tile("films", sing()).thumb ?? "").not.toContain("tmdb");
    h.app.core.details.setKey("abcd1234ownkey9876");
    await h.app.core.details.settled();
    await phone.settle();
    expect(screen().focusedId).toBe(before);
    expect(tile("films", sing()).thumb).toBe("file:///tmdb/poster/sing.jpg");
  });
});

describe("Fix match on a film", () => {
  test("the phone offers it when a film is focused; Menu opens it and Back returns to the tile", async () => {
    await start({ key: true });
    await focusId(`films:${sing()}`);
    expect(phone.last!.fixAvailable).toBe(true);
    await phone.press("menu");
    expect(screen().state.view).toBe("fixMatch");
    expect(screen().fixMatch!.name).toBe("Sing");
    await phone.press("back");
    expect(screen().state.view).toBe("library");
    expect(focusedId()).toBe(`films:${sing()}`);
  });

  test("choosing frames for a film drops its art", async () => {
    await start({ key: true });
    await focusId(`films:${sing()}`);
    await phone.press("menu");
    await h.app.core.details.settled();
    await focusId("frames");
    await phone.press("ok");
    await h.app.core.details.settled();
    await phone.settle();
    expect(screen().state.view).toBe("library");
    expect(tile("films", sing()).thumb ?? "").not.toContain("tmdb");
  });

  test("no Fix match without a key", async () => {
    await start({ key: false });
    await focusId(`films:${sing()}`);
    expect(phone.last!.fixAvailable).toBeUndefined();
    await phone.press("menu");
    expect(screen().state.view).toBe("library");
  });
});
