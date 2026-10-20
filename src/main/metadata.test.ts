import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { MetadataError } from "./ports/metadata.ts";
import { FileStore } from "./ports/store.ts";
import { TmdbMetadata } from "./ports/tmdb-metadata.ts";
import { startHarness, type Harness } from "./testing/harness.ts";

const BEARER = "eyJhbGciOi.PROJECT.token";
const OWN = "abcd1234ownkey9876";
const DAY = 24 * 60 * 60_000;

let root: string;
let storeDir: string;
let h: Harness | undefined;
const touch = (...parts: string[]) => {
  const p = join(root, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-meta-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-metastore-"));
  touch("Arcane", "Arcane S01E01.mkv");
  touch("Arcane", "Arcane S02E01.mkv");
  touch("Sing", "Sing (2016)", "Sing.2016.1080p.mkv");
});
afterEach(async () => {
  await h?.stop();
  h = undefined;
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

async function start(projectKey = BEARER, own?: string) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  if (own) store.write("tmdb", { key: own });
  return begin(store, projectKey);
}
async function begin(store: FileStore, projectKey: string | undefined) {
  h = await startHarness(store, { tmdbProjectKey: projectKey });
  h.metadata.catalog.show.arcane = [
    { id: 11, name: "Arcane: League", year: 2021, posterPath: "/wrong.jpg", popularity: 5 },
    { id: 94605, name: "Arcane", year: 2021, overview: "Piltover.", posterPath: "/arcane.jpg" },
  ];
  h.metadata.catalog.film.sing = [
    { id: 335797, name: "Sing", year: 2016, posterPath: "/sing.jpg" },
    { id: 438695, name: "Sing 2", year: 2021, posterPath: "/sing2.jpg" },
  ];
  await settle();
  return h;
}
async function settle() {
  await h!.app.core.library.settled();
  await h!.app.core.details.settled();
}
const core = () => h!.app.core;
const show = () => core().library.shows()[0]!;
const film = () => core().library.films()[0]!;

describe("matching", () => {
  test("a show and a film are matched, saved with images, and only cleaned title/year are sent", async () => {
    await start();
    expect(h!.metadata.searches).toEqual([
      { key: BEARER, kind: "show", title: "Arcane" },
      { key: BEARER, kind: "film", title: "Sing", year: 2016 },
    ]);
    const arcane = core().details.detailsFor(show().id)!;
    expect(arcane).toMatchObject({ tmdbId: 94605, name: "Arcane", overview: "Piltover." });
    expect(arcane.poster).toBe("file:///tmdb/poster/arcane.jpg");
    expect(arcane.seasons.map((s) => s.number)).toEqual([1, 2]);
    expect(arcane.seasons[0]!.episodes[0]).toMatchObject({ name: "S1E1 name" });
    expect(arcane.seasons[0]!.episodes[0]!.still).toBe("file:///tmdb/still/still94605-1.jpg");
    expect(core().details.detailsFor(film().id)).toMatchObject({ tmdbId: 335797, year: 2016 });
    expect(JSON.stringify(h!.metadata.searches)).not.toContain(root);
  });

  test("the first result that matches the name wins, else the most popular", async () => {
    await start();
    // "Arcane: League" is more popular but only the exact name counts.
    expect(core().details.detailsFor(show().id)!.tmdbId).toBe(94605);
    h!.metadata.catalog.show.arcane = [
      { id: 1, name: "Arcane Beta", popularity: 1 },
      { id: 2, name: "Arcane Alpha", popularity: 9 },
    ];
    core().details.refresh();
    await settle();
    expect(core().details.detailsFor(show().id)!.tmdbId).toBe(2);
  });

  test("details survive a restart with no second fetch; Refresh fetches again", async () => {
    await start();
    await h!.stop();
    const store = new FileStore(storeDir);
    await begin(store, BEARER);
    expect(h!.metadata.searches).toEqual([]);
    expect(h!.metadata.detailCalls).toEqual([]);
    expect(core().details.detailsFor(show().id)).toMatchObject({ tmdbId: 94605 });
    core().details.refresh();
    await settle();
    expect(h!.metadata.searches).toHaveLength(2);
  });
});

describe("Fix match", () => {
  test("lists the top 5 with posters, re-links, and survives Refresh", async () => {
    await start();
    h!.metadata.catalog.show.arcane = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
      id: i,
      name: `Arcane ${i}`,
      year: 2000 + i,
      posterPath: `/p${i}.jpg`,
    }));
    const options = await core().details.candidates(show().id);
    expect(options.map((o) => o.tmdbId)).toEqual([1, 2, 3, 4, 5]);
    expect(options[0]).toMatchObject({
      name: "Arcane 1",
      year: 2001,
      poster: "file:///tmdb/poster/p1.jpg",
    });
    await core().details.fixMatch(show().id, 4);
    expect(core().details.detailsFor(show().id)!.tmdbId).toBe(4);
    const searches = h!.metadata.searches.length;
    core().details.refresh();
    await settle();
    expect(core().details.detailsFor(show().id)!.tmdbId).toBe(4);
    expect(h!.metadata.detailCalls.slice(-2).map((c) => c.id)).toContain(4);
    // Refresh re-fetched Sing's search only; Arcane kept its chosen id.
    expect(h!.metadata.searches.length).toBe(searches + 1);
  });

  test("Use video frames turns details off for that title and keeps it off", async () => {
    await start();
    await core().details.fixMatch(show().id, "frames");
    expect(core().details.detailsFor(show().id)).toBeUndefined();
    expect(core().details.usesFrames(show().id)).toBe(true);
    const before = h!.metadata.searches.length;
    core().details.refresh();
    await settle();
    expect(h!.metadata.searches.length).toBe(before + 1); // only the film
    expect(core().details.detailsFor(show().id)).toBeUndefined();
  });
});

describe("falling back to frames", () => {
  test("no key: no lookups, 'No key'", async () => {
    await start("");
    expect(h!.metadata.searches).toEqual([]);
    expect(core().details.detailsFor(show().id)).toBeUndefined();
    expect(core().details.settings().keyLabel).toBe("No key");
  });

  test("a lookup error or no match is retried at most once a day", async () => {
    const store = new FileStore(storeDir);
    store.write("library", { folders: [root] });
    h = await startHarness(store, { tmdbProjectKey: BEARER });
    h.metadata.fail = new MetadataError("offline");
    await settle();
    expect(h.metadata.searches).toHaveLength(2);
    core().details.sync();
    await settle();
    expect(h.metadata.searches).toHaveLength(2);
    h.clock.advance(DAY - 1000);
    core().details.sync();
    await settle();
    expect(h.metadata.searches).toHaveLength(2);
    h.clock.advance(2000);
    h.metadata.fail = undefined;
    core().details.sync();
    await settle();
    // No catalogue entries here: "no match", retried only after another day.
    expect(h.metadata.searches).toHaveLength(4);
    core().details.sync();
    await settle();
    expect(h.metadata.searches).toHaveLength(4);
    expect(core().details.detailsFor(show().id)).toBeUndefined();
  });

  test("429 is retried after the wait, then succeeds", async () => {
    const store = new FileStore(storeDir);
    store.write("library", { folders: [root] });
    h = await startHarness(store, { tmdbProjectKey: BEARER });
    let left = 1;
    h.metadata.fail = () => (left-- > 0 ? new MetadataError("slow down", 429, 3) : undefined);
    h.metadata.catalog.show.arcane = [{ id: 7, name: "Arcane" }];
    await h.app.core.library.settled();
    await new Promise((r) => setTimeout(r, 20));
    expect(core().details.detailsFor(show().id)).toBeUndefined();
    h.clock.advance(3000);
    await settle();
    expect(core().details.detailsFor(show().id)!.tmdbId).toBe(7);
  });
});

describe("keys", () => {
  test("the household's key beats the project key; Bearer for eyJ, api_key otherwise", async () => {
    await start(BEARER, OWN);
    expect(h!.metadata.searches.every((s) => s.key === OWN)).toBe(true);
    expect(core().details.settings().keyLabel).toBe("Your key •••• 9876");
    core().details.setKey(undefined);
    expect(core().details.settings().keyLabel).toBe("Built-in key");
    core().details.refresh();
    await settle();
    expect(h!.metadata.searches.at(-1)!.key).toBe(BEARER);
  });

  test("the adapter sends Bearer for eyJ tokens and api_key for other keys, never in errors", async () => {
    const urls: { url: string; auth?: string }[] = [];
    const tmdb = new TmdbMetadata(storeDir, (url, init) => {
      urls.push({ url, auth: init?.headers?.authorization });
      return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    });
    await tmdb.search("eyJabc.def.ghi", "show", "Arcane");
    await tmdb.search("v3key0123", "film", "Sing", 2016);
    expect(urls[0]!.auth).toBe("Bearer eyJabc.def.ghi");
    expect(urls[0]!.url).not.toContain("api_key");
    expect(urls[0]!.url).toContain("/search/tv?query=Arcane");
    expect(urls[1]!.auth).toBeUndefined();
    expect(urls[1]!.url).toContain("api_key=v3key0123");
    expect(urls[1]!.url).toContain("/search/movie?query=Sing&year=2016");
    const bad = new TmdbMetadata(storeDir, () =>
      Promise.resolve(new Response("{}", { status: 401 })),
    );
    const error = await bad.search("v3secretkey", "show", "x").catch((e: Error) => e);
    expect((error as MetadataError).status).toBe(401);
    expect((error as Error).message).not.toContain("v3secretkey");
  });

  test("a revoked project key falls back to frames and shows the Settings hint", async () => {
    const store = new FileStore(storeDir);
    store.write("library", { folders: [root] });
    h = await startHarness(store, { tmdbProjectKey: BEARER });
    h.metadata.fail = new MetadataError("revoked", 401);
    await settle();
    expect(core().details.detailsFor(show().id)).toBeUndefined();
    expect(core().details.settings().hint).toBe("Add your own TMDB key for details");
    const phone = await h.connectPhone();
    await phone.press("up");
    await phone.press("ok");
    expect(h.screen.last.state.view).toBe("settings");
    expect(h.screen.last.details?.hint).toBe("Add your own TMDB key for details");
    // It stops trying instead of hammering the API.
    const tries = h.metadata.searches.length;
    core().details.sync();
    await settle();
    expect(h.metadata.searches.length).toBe(tries);
    // The household's own key clears the hint and works.
    h.metadata.fail = undefined;
    h.metadata.catalog.show.arcane = [{ id: 7, name: "Arcane" }];
    core().details.setKey(OWN);
    await settle();
    expect(core().details.settings().hint).toBeUndefined();
    expect(core().details.detailsFor(show().id)).toBeDefined();
  });

  test("Off stops lookups", async () => {
    await start();
    core().details.setEnabled(false);
    const n = h!.metadata.searches.length;
    core().details.refresh();
    await settle();
    expect(h!.metadata.searches.length).toBe(n);
  });
});

describe("Settings: Show and film details", () => {
  async function openDetails() {
    const phone = await h!.connectPhone();
    await phone.press("up");
    await phone.press("ok");
    for (let i = 0; i < 3; i++) await phone.press("down");
    await phone.press("ok");
    expect(h!.screen.last.state.view).toBe("details");
    return phone;
  }

  test("the key is typed on the phone's typing sheet and never shown back in full", async () => {
    await start("");
    const phone = await openDetails();
    expect(h!.screen.last.grid.map((i) => i.label)).toEqual([
      "Use my own key",
      "Online details",
      "Refresh details",
      "Credits",
    ]);
    expect(phone.last!.typeAvailable).toBe(true);
    const sheet = await phone.press("ok");
    expect(sheet.typing).toBe("you");
    await phone.press({ command: "typeText", args: { text: OWN } });
    const snap = await phone.press("typeSubmit");
    expect(snap.typing).toBe("none");
    await settle();
    expect(core().details.settings().keyLabel).toBe("Your key •••• 9876");
    expect(h!.metadata.searches[0]!.key).toBe(OWN);
    const everything = JSON.stringify([h!.screen.payloads, phone.snapshots]);
    expect(everything).not.toContain(OWN);
    expect(everything).not.toContain("abcd1234ownkey");
    // Remove my key goes back to the built-in key (none here).
    await phone.press("down");
    expect(h!.screen.last.grid.map((i) => i.label)).toContain("Remove my key");
    await phone.press("ok");
    expect(core().details.settings().keyLabel).toBe("No key");
  });

  test("neither key appears in a snapshot or payload", async () => {
    await start(BEARER, OWN);
    const phone = await openDetails();
    await phone.press("down");
    const all = JSON.stringify([h!.screen.payloads, phone.snapshots]);
    expect(all).not.toContain(BEARER);
    expect(all).not.toContain(OWN);
    expect(all).not.toContain("PROJECT");
  });

  test("Credits opens and Back returns", async () => {
    await start();
    const phone = await openDetails();
    for (let i = 0; i < 3; i++) await phone.press("down");
    await phone.press("ok");
    expect(h!.screen.last.state.view).toBe("credits");
    await phone.press("back");
    expect(h!.screen.last.state.view).toBe("details");
  });
});
