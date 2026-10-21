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

const ep = join_("Arcane", "Season 1", "Arcane S01E01.mkv");
const sing = join_("Sing", "Sing (2016)", "Sing.2016.mkv");
const dune = join_("Dune", "Dune (2021)", "Dune.2021.mkv");
function join_(...parts: string[]) {
  return parts.join("/");
}
const at = (rel: string) => join(root, rel);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-genres-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-genrestore-"));
  for (const rel of [ep, sing, dune]) {
    mkdirSync(join(at(rel), ".."), { recursive: true });
    writeFileSync(at(rel), "");
  }
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

async function start() {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  h = await startHarness(store, { tmdbProjectKey: "eyJ.test.key" });
  h.metadata.catalog.show.arcane = [{ id: 1, name: "Arcane", year: 2021 }];
  h.metadata.catalog.film.sing = [{ id: 2, name: "Sing", year: 2016 }];
  h.metadata.catalog.film.dune = [{ id: 3, name: "Dune", year: 2021 }];
  const base = { year: 2021, seasons: [] as never[] };
  h.metadata.detailsById.set(1, {
    ...base,
    id: 1,
    name: "Arcane",
    genres: ["Animation", "Sci-Fi & Fantasy", "Action & Adventure", "Drama"],
    seasons: [{ number: 1, episodes: [{ number: 1, name: "Welcome" }] }],
  });
  h.metadata.detailsById.set(2, { ...base, id: 2, name: "Sing", genres: ["Animation", "Comedy"] });
  h.metadata.detailsById.set(3, { ...base, id: 3, name: "Dune", genres: [] });
  await h.app.core.library.settled();
  await h.app.core.details.settled();
  phone = await h.connectPhone();
  await phone.press("home");
  await focusId("library");
  await phone.press("ok");
}

const screen = () => h.screen.last;
async function focusId(id: string) {
  for (let i = 0; i < 80 && screen().focusedId !== id; i++) {
    const { grid } = screen();
    const cur = grid.find((x) => x.id === screen().focusedId)!;
    const t = grid.find((x) => x.id === id)!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(screen().focusedId).toBe(id);
}
const tile = (row: string, key: string) =>
  screen()
    .library!.rows!.find((r) => r.id === row)!
    .entries.find((e) => e.id === `${row}:${key}`)!;

describe("Genre labels", () => {
  test("the featured area carries up to three genres; none without details", async () => {
    await start();
    expect(tile("shows", "show:arcane").feature!.genres).toEqual([
      "Animation",
      "Sci-Fi & Fantasy",
      "Action & Adventure",
    ]);
    expect(tile("films", at(sing)).feature!.genres).toEqual(["Animation", "Comedy"]);
    expect(tile("films", at(dune)).feature!.genres).toBeUndefined();
  });

  test("a title without details has no genres", async () => {
    await start();
    await h.app.core.details.fixMatch(screen().library!.rows![0]!.entries[0]!.path, "frames");
    const frames = screen()
      .library!.rows!.flatMap((r) => r.entries)
      .filter((e) => e.feature?.kind === "Show");
    expect(frames.every((e) => e.feature!.genres === undefined)).toBe(true);
  });

  test("the show page carries up to three genres", async () => {
    await start();
    await focusId("shows:show:arcane");
    await phone.press("ok");
    expect(screen().show!.genres).toEqual(["Animation", "Sci-Fi & Fantasy", "Action & Adventure"]);
  });

  test("the phone's Now Playing shows the genres as one line", async () => {
    await start();
    await focusId(`films:${at(sing)}`);
    await phone.press("ok");
    await phone.waitFor(() => phone.last!.nowPlaying !== undefined);
    expect(phone.last!.nowPlaying!.genres).toBe("Animation · Comedy");
  });

  test("no genres line on Now Playing without any", async () => {
    await start();
    await focusId(`films:${at(dune)}`);
    await phone.press("ok");
    await phone.waitFor(() => phone.last!.nowPlaying !== undefined);
    expect(phone.last!.nowPlaying!.genres).toBeUndefined();
  });
});
