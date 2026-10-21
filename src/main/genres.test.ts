import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { languageName } from "./core/language.ts";
import { FileStore } from "./ports/store.ts";
import { TmdbMetadata } from "./ports/tmdb-metadata.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

const KEY = "eyJhbGciOi.PROJECT.token";
let root: string;
let storeDir: string;
let h: Harness | undefined;
const touch = (...parts: string[]) => {
  const p = join(root, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-genres-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-genresstore-"));
  touch("Arcane", "Arcane S01E01.mkv");
  touch("Sing", "Sing (2016)", "Sing.2016.1080p.mkv");
  touch("Premam", "Premam (2015)", "Premam.2015.mkv");
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const core = () => h!.app.core;
async function settle() {
  await core().library.settled();
  await core().details.settled();
}
async function begin(setup?: (store: FileStore) => void) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  setup?.(store);
  h = await startHarness(store, { tmdbProjectKey: KEY });
  h.metadata.catalog.show.arcane = [{ id: 1, name: "Arcane", year: 2021 }];
  h.metadata.catalog.film.sing = [{ id: 2, name: "Sing", year: 2016 }];
  h.metadata.catalog.film.premam = [{ id: 3, name: "Premam", year: 2015 }];
  h.metadata.detailsById.set(1, {
    id: 1,
    name: "Arcane",
    genres: ["Animation", "Drama"],
    language: "en",
    seasons: [],
  });
  h.metadata.detailsById.set(2, {
    id: 2,
    name: "Sing",
    year: 2016,
    genres: ["Animation", "Comedy"],
    language: "en",
    seasons: [],
  });
  h.metadata.detailsById.set(3, {
    id: 3,
    name: "Premam",
    year: 2015,
    genres: ["Drama", "Romance"],
    language: "ml",
    seasons: [],
  });
  await settle();
  return h;
}

describe("genres and languages", () => {
  test("lookups save genres and language; counts and filters work", async () => {
    await begin();
    const d = core().details;
    expect(d.languages()).toEqual([
      { key: "en", name: "English", count: 2 },
      { key: "ml", name: "Malayalam", count: 1 },
    ]);
    expect(d.genres()).toEqual([
      { key: "Animation", name: "Animation", count: 2 },
      { key: "Drama", name: "Drama", count: 2 },
      { key: "Comedy", name: "Comedy", count: 1 },
      { key: "Romance", name: "Romance", count: 1 },
    ]);
    const film = (name: string) =>
      core()
        .library.films()
        .find((f) => f.title.startsWith(name))!.id;
    expect(d.filter({ language: "ml" })).toEqual([film("Premam")]);
    expect(d.filter({ genre: "Drama" })).toHaveLength(2);
    expect(d.filter({ genre: "Drama", kind: "film" })).toEqual([film("Premam")]);
    expect(d.filter({ kind: "show" })).toEqual([core().library.shows()[0]!.id]);
    expect(d.filter({ language: "en", genre: "Romance" })).toEqual([]);
  });

  test("language names fall back to the code", () => {
    expect(languageName("ml")).toBe("Malayalam");
    expect(languageName("en")).toBe("English");
    expect(languageName("zzzz9")).toBe("zzzz9");
  });

  test("the adapter reads genre names and original_language", async () => {
    const tmdb = new TmdbMetadata(storeDir, () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            title: "Premam",
            genres: [
              { id: 18, name: "Drama" },
              { id: 10749, name: "Romance" },
            ],
            original_language: "ml",
          }),
          { status: 200 },
        ),
      ),
    );
    expect(await tmdb.details("v3key", "film", 3, [])).toMatchObject({
      genres: ["Drama", "Romance"],
      language: "ml",
    });
  });

  describe("backfill", () => {
    test("runs once for titles missing genres, details only, never again after a restart", async () => {
      const store = new FileStore(storeDir);
      store.write("library", { folders: [root] });
      h = await startHarness(store, {});
      await core().library.settled();
      const id = core().library.shows()[0]!.id;
      await h.stop();

      store.write("metadata", {
        items: { [id]: { state: "matched", triedAt: 1, tmdbId: 1, name: "Arcane" } },
      });
      h = await startHarness(store, {
        tmdbProjectKey: KEY,
        metadata: (m) =>
          m.detailsById.set(1, {
            id: 1,
            name: "Arcane",
            genres: ["Drama"],
            language: "en",
            seasons: [],
          }),
      });
      await settle();
      expect(h.metadata.detailCalls.filter((c) => c.id === 1)).toEqual([
        { key: KEY, kind: "show", id: 1, seasons: [] },
      ]);
      expect(
        core()
          .details.genres()
          .map((g) => g.key),
      ).toContain("Drama");
      expect(h.metadata.images.some((i) => i.startsWith("poster/a"))).toBe(false);
      expect(store.read<{ genresBackfilled?: boolean }>("metadata", {}).genresBackfilled).toBe(
        true,
      );

      await h.stop();
      h = await startHarness(new FileStore(storeDir), { tmdbProjectKey: KEY });
      await settle();
      expect(h.metadata.searches).toEqual([]);
      expect(h.metadata.detailCalls).toEqual([]);
    });
  });
});
