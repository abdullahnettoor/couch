import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { MetadataError } from "./ports/metadata.ts";
import { TmdbMetadata } from "./ports/tmdb-metadata.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

const DAY = 24 * 60 * 60 * 1000;
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
describe("genres and languages", () => {
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
    const detail = (id: number, name: string) => ({
      id,
      name,
      genres: ["Drama"],
      language: "en",
      seasons: [],
    });
    const seed = (store: FileStore, ids: Record<string, number>) =>
      store.write("metadata", {
        items: Object.fromEntries(
          Object.entries(ids).map(([id, tmdbId]) => [
            id,
            { state: "matched", triedAt: 1, tmdbId, name: "x" },
          ]),
        ),
      });
    const genreKeys = () =>
      core()
        .details.genres()
        .map((g) => g.key);
    async function ids() {
      const store = new FileStore(storeDir);
      store.write("library", { folders: [root] });
      h = await startHarness(store, {});
      await core().library.settled();
      const out = {
        arcane: core().library.shows()[0]!.id,
        sing: core()
          .library.films()
          .find((f) => f.title.startsWith("Sing"))!.id,
      };
      await h.stop();
      return { store, ...out };
    }
    const restart = (store: FileStore, fail?: boolean) =>
      startHarness(store, {
        tmdbProjectKey: KEY,
        metadata: (m) => {
          m.detailsById.set(1, detail(1, "Arcane"));
          m.detailsById.set(2, detail(2, "Sing"));
          if (fail) m.fail = new MetadataError("down");
        },
      });

    test("fills missing genres from the details endpoint only, and never fetches again after a restart", async () => {
      const { store, arcane } = await ids();
      seed(store, { [arcane]: 1 });
      h = await restart(store);
      await settle();
      expect(h.metadata.detailCalls.filter((c) => c.id === 1)).toEqual([
        { key: KEY, kind: "show", id: 1, seasons: [] },
      ]);
      expect(genreKeys()).toContain("Drama");
      expect(h.metadata.images.some((i) => i.startsWith("poster/a"))).toBe(false);

      await h.stop();
      h = await startHarness(new FileStore(storeDir), { tmdbProjectKey: KEY });
      await settle();
      expect(h.metadata.searches).toEqual([]);
      expect(h.metadata.detailCalls).toEqual([]);
    });

    test("a failed run is not retried on restart within the day", async () => {
      const { store, arcane, sing } = await ids();
      seed(store, { [arcane]: 1, [sing]: 2 });
      h = await restart(store, true);
      await settle();
      expect(h.metadata.detailCalls.length).toBeGreaterThan(0);
      await h.stop();

      h = await restart(store);
      await settle();
      expect(h.metadata.detailCalls).toEqual([]);
    });

    test("titles that failed are tried again after a day, not before", async () => {
      const { store, arcane } = await ids();
      seed(store, { [arcane]: 1 });
      h = await restart(store, true);
      await settle();
      const first = h.metadata.detailCalls.length;
      expect(first).toBeGreaterThan(0);
      core().details.sync();
      await settle();
      expect(h.metadata.detailCalls).toHaveLength(first);

      h.metadata.fail = undefined;
      h.clock.advance(DAY + 1000);
      core().details.sync();
      await settle();
      expect(h.metadata.detailCalls.length).toBeGreaterThan(first);
      expect(genreKeys()).toContain("Drama");
    });
  });
});
