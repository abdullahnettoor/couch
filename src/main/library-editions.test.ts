import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { parseTitle, presentation } from "./core/library.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

const parsed = (file: string) => {
  const { name, edition } = parseTitle(file);
  return { name, edition };
};

describe("edition tags", () => {
  test("the household's Lord of the Rings names", () => {
    expect(
      parsed("The.Lord.of.the.Rings.The.Return.of.the.King.EXTENDED.2003.1080p.BluRay.x264.mkv"),
    ).toEqual({ name: "The Lord of the Rings The Return of the King (2003)", edition: "Extended" });
    expect(
      parsed("The Lord of the Rings The Fellowship of the Ring THEATRICAL EDITION (2001).mkv"),
    ).toEqual({
      name: "The Lord of the Rings The Fellowship of the Ring (2001)",
      edition: "Theatrical",
    });
  });

  test("other editions, with any separators and case", () => {
    expect(parsed("Movie.Directors.Cut.2010.mkv")).toEqual({
      name: "Movie (2010)",
      edition: "Director's Cut",
    });
    expect(parsed("Film (2019) Remastered.mkv")).toEqual({
      name: "Film (2019)",
      edition: "Remastered",
    });
    expect(parsed("Blade Runner (1982) director's cut.mp4")).toEqual({
      name: "Blade Runner (1982)",
      edition: "Director's Cut",
    });
    expect(parsed("Alien-1979-Final-Cut.mkv").edition).toBe("Final Cut");
    expect(parsed("Heat 1995 20th Anniversary Edition 1080p.mkv").edition).toBe(
      "Anniversary Edition",
    );
    expect(parsed("Dune 2021 IMAX 2160p.mkv")).toEqual({ name: "Dune (2021)", edition: "IMAX" });
    expect(parsed("Se7en 1995 UNRATED.mkv")).toEqual({ name: "Se7en (1995)", edition: "Unrated" });
    expect(parsed("Film 2001 Extended Cut Remastered.mkv").edition).toBe("Extended, Remastered");
  });

  test("real words stay: Part 1, Extended Family, a title that is only an edition word", () => {
    expect(parsed("Extended Family (2023).mkv")).toEqual({
      name: "Extended Family (2023)",
      edition: undefined,
    });
    expect(parsed("The Extended Family Reunion 2023.mkv").name).toBe(
      "The Extended Family Reunion (2023)",
    );
    expect(parsed("Harry Potter Part 1 (2010).mkv")).toEqual({
      name: "Harry Potter Part 1 (2010)",
      edition: undefined,
    });
    expect(parsed("Uncut.mkv")).toEqual({ name: "Uncut", edition: undefined });
    expect(parsed("Unrated Truth 2012.mkv").name).toBe("Unrated Truth (2012)");
  });

  test("the edition is the film's small line", () => {
    expect(presentation("/x/Movie.Directors.Cut.2010.mkv")).toEqual({
      title: "Movie (2010)",
      line: "Director's Cut",
    });
    expect(presentation("/x/Plain (2010).mkv").line).toBeUndefined();
  });
});

let root: string;
let storeDir: string;
let h: Harness | undefined;
let phone: FakePhone;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-ed-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-edstore-"));
});
afterEach(async () => {
  await h?.stop();
  h = undefined;
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const touch = (...parts: string[]) => {
  const p = join(root, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
};

async function start(tmdb = false) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store, tmdb ? { tmdbProjectKey: "eyJ.test.key" } : {});
  await h.app.core.library.settled();
  await h.app.core.details.settled();
  phone = await h.connectPhone();
  await phone.press("home");
  await focusOn("library");
  await phone.press("ok");
}
const lib = () => h!.screen.last.library!;
const focusedId = () => h!.screen.last.focusedId;
async function focusOn(id: string) {
  for (let i = 0; i < 80 && focusedId() !== id; i++) {
    const { grid } = h!.screen.last;
    const cur = grid.find((x) => x.id === focusedId())!;
    const t = grid.find((x) => x.id === id)!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(focusedId()).toBe(id);
}

describe("editions in the Library and TMDB", () => {
  test("TMDB is searched with the clean title and year", async () => {
    touch("Return.of.the.King.EXTENDED.2003.1080p.mkv");
    await start(true);
    expect(h!.metadata.searches).toEqual([
      { key: "eyJ.test.key", kind: "film", title: "Return of the King", year: 2003 },
    ]);
  });

  test("the tile caption and the featured line carry the edition", async () => {
    touch("Return.of.the.King.EXTENDED.2003.mkv");
    touch("Heat.1995.mkv");
    await start();
    const films = lib().rows!.find((r) => r.id === "films")!.entries;
    const king = films.find((e) => e.title === "Return of the King")!;
    expect(king.line).toBe("Extended");
    expect(king.feature).toMatchObject({ kind: "Film", sub: "2003 · Extended" });
    expect(films.find((e) => e.title === "Heat")!.line).toBeUndefined();
    const recent = lib().rows!.find((r) => r.id === "recent")!.entries;
    expect(recent.find((e) => e.title === "Return of the King")!.line).toBe("Film · Extended");
  });
});

describe("the featured area is never blank", () => {
  const seed = () => {
    touch("Arcane", "Arcane S01E01.mkv");
    touch("Heat.1995.mkv");
    touch("Elemental.2023.mkv");
  };
  const firstTile = () => {
    const e = lib().rows![0]!.entries[0]!;
    return e.id ?? e.path;
  };

  test("right after opening the Library it shows the first tile", async () => {
    seed();
    await start();
    expect(lib().featuredId).toBe(firstTile());
  });

  test("on a chip it keeps the last focused tile", async () => {
    seed();
    await start();
    await phone.press("right");
    const tile = focusedId();
    expect(lib().featuredId).toBe(tile);
    await phone.press("up");
    expect(focusedId()).toBe("chip:all");
    expect(lib().featuredId).toBe(tile);
    await phone.press("right");
    expect(focusedId()).toBe("chip:shows");
    expect(lib().featuredId).toBe(tile);
  });

  test("a chosen chip features the first tile of the first filtered row until a tile is focused", async () => {
    seed();
    await start();
    await focusOn("films:" + join(root, "Heat.1995.mkv"));
    await focusOn("chip:shows");
    await phone.press("ok");
    expect(lib().rows!.map((r) => r.id)).toEqual(["shows", "recent"]);
    expect(lib().featuredId).toBe(firstTile());
    expect(focusedId()).toBe("chip:shows");
    await phone.press("down");
    expect(lib().featuredId).toBe(focusedId());
  });

  test("an empty Library features its folder tile", async () => {
    await start();
    expect(lib().featuredId).toBe(root);
  });
});
