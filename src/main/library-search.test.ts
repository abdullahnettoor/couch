import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { normalise, rank } from "./core/library-search.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;

const ep = (n: number) => join(root, "Arcane", "Season 1", `Arcane S01E0${n}.mkv`);
const panda = () => join(root, "Films", "Kung Fu Panda 4 (2024).mkv");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-search-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-searchstore-"));
  mkdirSync(join(root, "Arcane", "Season 1"), { recursive: true });
  for (const n of [1, 2]) writeFileSync(ep(n), "");
  mkdirSync(join(root, "Films"), { recursive: true });
  for (const f of ["Kung Fu Panda 4 (2024)", "Panda (2020)", "Pandemic (2019)", "Amélie (2001)"])
    writeFileSync(join(root, "Films", `${f}.mkv`), "");
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

async function start(opts: { key?: boolean } = {}) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store, opts.key ? { tmdbProjectKey: "eyJ.test.key" } : undefined);
  if (opts.key) {
    h.metadata.catalog.show.arcane = [{ id: 94605, name: "Arcane", year: 2021 }];
    h.metadata.detailsById.set(94605, {
      id: 94605,
      name: "Arcane",
      year: 2021,
      seasons: [
        {
          number: 1,
          episodes: [
            { number: 1, name: "Welcome to the Playground" },
            { number: 2, name: "Happy Progress Day!" },
          ],
        },
      ],
    } as never);
  }
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
async function openSearch() {
  await focusId("search");
  await phone.press("ok");
  expect(screen().state.view).toBe("librarySearch");
}
async function type(text: string) {
  await phone.press({ command: "typeText", args: { text } });
}
const rows = () => screen().search!.rows;
const titles = (id: string) =>
  rows()
    .find((r) => r.id === id)
    ?.entries.map((e) => e.title) ?? [];

describe("normalise and rank", () => {
  test("case, accents, separators", () => {
    expect(normalise("  Amélie_Poulain.2001-HD ")).toBe("amelie poulain 2001 hd");
  });
  test("exact, starts-with, word-prefix in any order", () => {
    expect(rank("Panda", "panda")).toBe(0);
    expect(rank("Panda Express", "panda")).toBe(1);
    expect(rank("Kung Fu Panda 4", "panda kung")).toBe(2);
    expect(rank("Kung Fu Panda 4", "pandas")).toBeUndefined();
  });
});

describe("Library search", () => {
  test("search icon is left of the gear; OK opens an empty search", async () => {
    await start();
    await openSearch();
    expect(screen().search!.query).toBe("");
    expect(rows()).toEqual([]);
    expect(focusedId()).toBe("field");
  });

  test("typing from the phone updates results live, ranked, with no key and no network", async () => {
    await start();
    await openSearch();
    await phone.press("typeOpen");
    expect(h.screen.last.search!.typing).toBe(true);
    await type("pan");
    expect(titles("films")).toEqual(["Panda", "Pandemic", "Kung Fu Panda 4"]);
    await type("panda kung");
    expect(titles("films")).toEqual(["Kung Fu Panda 4"]);
    await type("amelie");
    expect(titles("films")).toEqual(["Amélie"]);
    await type("arc");
    expect(titles("shows")).toEqual(["Arcane"]);
    expect(h.metadata.searches).toEqual([]);
  });

  test("episode names, including TMDB names, are found", async () => {
    await start({ key: true });
    await openSearch();
    await phone.press("typeOpen");
    await type("happy progress");
    expect(titles("episodes")).toEqual(["Happy Progress Day!"]);
    expect(rows().find((r) => r.id === "episodes")!.entries[0]!.line).toContain("Arcane · ");
    await type("zzz");
    expect(rows()).toEqual([]);
  });

  test("at most 20 per group", async () => {
    for (let i = 10; i < 40; i++) writeFileSync(join(root, "Films", `Pan ${i}.mkv`), "");
    await start();
    await openSearch();
    await phone.press("typeOpen");
    await type("pan");
    expect(rows().find((r) => r.id === "films")!.entries).toHaveLength(20);
  });

  test("submit focuses the first result; cancel keeps the query", async () => {
    await start();
    await openSearch();
    await phone.press("typeOpen");
    await type("panda");
    const s = await phone.press("typeSubmit");
    expect(s.typing).toBe("none");
    expect(focusedId()).toBe(`search:films:${join(root, "Films", "Panda (2020).mkv")}`);
    await phone.press("typeOpen");
    expect(phone.last!.typeSeed).toBe("panda");
    expect(phone.last!.typePlaceholder).toBe("Search your Library");
    await type("pand");
    await phone.press("typeCancel");
    expect(screen().search!.query).toBe("pand");
  });

  test("the query never reaches YouTube", async () => {
    await start();
    await openSearch();
    await phone.press("typeOpen");
    await type("panda");
    await phone.press("typeSubmit");
    expect(h.youtube.calls.filter((c) => /earch/.test(c.call))).toEqual([]);
  });

  test("OK plays a film; Back from the player returns to the search with query and focus", async () => {
    await start();
    await openSearch();
    await phone.press("typeOpen");
    await type("kung");
    await phone.press("typeSubmit");
    const id = focusedId();
    await phone.press("ok");
    expect(h.player.calls.find((c) => c.call === "load")!.args[0]).toBe(panda());
    await phone.press("back");
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().search!.query).toBe("kung");
    expect(focusedId()).toBe(id);
  });

  test("OK on a show opens its page; Back returns to the search, then Back to the Library clears it", async () => {
    await start();
    await openSearch();
    await phone.press("typeOpen");
    await type("arcane");
    await phone.press("typeSubmit");
    const id = focusedId();
    await phone.press("ok");
    expect(screen().state.view).toBe("show");
    await phone.press("back");
    expect(screen().state.view).toBe("librarySearch");
    expect(screen().search!.query).toBe("arcane");
    expect(focusedId()).toBe(id);
    await phone.press("back");
    expect(screen().state.view).toBe("library");
    await openSearch();
    expect(screen().search!.query).toBe("");
  });

  test("Home goes Home", async () => {
    await start();
    await openSearch();
    expect((await phone.press("home")).view).toBe("home");
  });

  test("phone: Search Library button and the librarySearch layout", async () => {
    await start();
    expect(phone.last!.typeLabel).toBe("Search Library");
    expect(phone.last!.typeAvailable).toBe(true);
    await phone.press("typeOpen");
    expect(screen().state.view).toBe("librarySearch");
    expect(phone.last!.layout).toBe("librarySearch");
    expect(phone.last!.typing).toBe("you");
    await phone.press("typeCancel");
    expect(phone.last!.typeLabel).toBe("Search Library");
  });

  test("empty search from the Screen without a phone typing shows the hint state", async () => {
    await start();
    await openSearch();
    await type("x");
    expect(screen().search!.query).toBe("");
  });

  describe("typing purpose never leaks", () => {
    async function otherPhoneToDetails() {
      const b = await h.connectPhone();
      await b.press("home");
      await b.press("up");
      await b.press("ok");
      for (let i = 0; i < 3; i++) await b.press("down");
      await b.press("ok");
      expect(screen().state.view).toBe("details");
      return b;
    }

    test("Settings → Details on another phone releases the search sheet; nothing is saved as a key", async () => {
      await start({ key: true });
      await openSearch();
      await phone.press("typeOpen");
      await type("arc");
      const b = await otherPhoneToDetails();
      expect(phone.last!.typing).toBe("none");
      await type("stolen-key");
      await phone.press("typeSubmit");
      await b.press("typeSubmit");
      expect(screen().state.toast).not.toBe("TMDB key saved");
      expect(JSON.stringify(h.screen.payloads)).not.toContain("stolen-key");
    });

    test("search → playback closes the sheet, so Cancel is not stuck", async () => {
      await start();
      await openSearch();
      await phone.press("typeOpen");
      await type("kung");
      await phone.press("typeSubmit");
      await phone.press("typeOpen");
      await phone.press("ok");
      expect(screen().state.view).toBe("player");
      expect(phone.last!.typing).toBe("none");
    });

    test("a stale search owner does not block YouTube typing, and nothing reaches the port", async () => {
      await start();
      await openSearch();
      await phone.press("typeOpen");
      await type("panda");
      await phone.press("home");
      expect(phone.last!.typing).toBe("none");
      expect(screen().state.view).toBe("home");
      await focusId("youtube");
      await phone.press("ok");
      expect(screen().state.view).toBe("youtube");
      await phone.press("typeOpen");
      expect(phone.last!.typing).toBe("you");
      await type("cats");
      expect(h.youtube.calls.filter((c) => c.call === "setSearchText").map((c) => c.args[0])).toEqual(["cats"]);
    });

    test("Back from a show restores query and focus without the sheet", async () => {
      await start();
      await openSearch();
      await phone.press("typeOpen");
      await type("arcane");
      await phone.press("typeSubmit");
      await phone.press("typeOpen");
      await phone.press("ok");
      expect(phone.last!.typing).toBe("none");
      await phone.press("back");
      expect(screen().search!.query).toBe("arcane");
    });

    test("Home clears the query", async () => {
      await start();
      await openSearch();
      await phone.press("typeOpen");
      await type("panda");
      await phone.press("home");
      await focusId("library");
      await phone.press("ok");
      await openSearch();
      expect(screen().search!.query).toBe("");
    });
  });
});
