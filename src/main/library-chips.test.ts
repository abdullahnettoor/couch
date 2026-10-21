import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

const KEY = "eyJhbGciOi.PROJECT.token";
let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;

const touch = (...parts: string[]) => {
  const p = join(root, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-chips-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-chipstore-"));
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

interface Spec {
  name: string;
  lang: string;
  genres: string[];
  show?: boolean;
}
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const named = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${letters[i]}`);

/** English: 6 films + Arcane (show); Malayalam: 6 films (3 Thriller); Tamil: 6 films; Hindi: 2 films. */
function household(): Spec[] {
  return [
    { name: "Arcane", lang: "en", genres: ["Drama"], show: true },
    ...named("Eng", 6).map((name) => ({ name, lang: "en", genres: ["Drama"] })),
    ...named("Mal", 6).map((name, i) => ({
      name,
      lang: "ml",
      genres: i < 3 ? ["Drama", "Thriller"] : ["Drama"],
    })),
    ...named("Tam", 6).map((name) => ({ name, lang: "ta", genres: ["Drama"] })),
    ...named("Hin", 2).map((name) => ({ name, lang: "hi", genres: ["Comedy"] })),
  ];
}

async function start(specs: Spec[] | undefined, history?: Record<string, unknown>) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  if (history) store.write("history", { items: history });
  for (const s of specs ?? household())
    if (s.show) touch(s.name, `${s.name} S01E01.mkv`);
    else touch(`${s.name}.2020.mkv`);
  h = await startHarness(store, specs ? { tmdbProjectKey: KEY } : {});
  if (specs)
    specs.forEach((s, i) => {
      const id = i + 1;
      h.metadata.catalog[s.show ? "show" : "film"][s.name.toLowerCase()] = [
        { id, name: s.name, year: s.show ? 2021 : 2020 },
      ];
      h.metadata.detailsById.set(id, {
        id,
        name: s.name,
        genres: s.genres,
        language: s.lang,
        seasons: [],
      });
    });
  await h.app.core.library.settled();
  await h.app.core.details.settled();
  phone = await h.connectPhone();
  await phone.press("home");
  await focusOn("library");
  await phone.press("ok");
}

const lib = () => h.screen.last.library!;
const chips = () => lib().chips!.map((c) => c.label);
const active = () =>
  lib()
    .chips!.filter((c) => c.active)
    .map((c) => c.label);
const rowIds = () => lib().rows!.map((r) => r.id);
const row = (id: string) => lib().rows!.find((r) => r.id === id)!;
const focusedId = () => h.screen.last.focusedId;

async function focusOn(id: string) {
  for (let i = 0; i < 80 && focusedId() !== id; i++) {
    const { grid } = h.screen.last;
    const cur = grid.find((x) => x.id === focusedId())!;
    const t = grid.find((x) => x.id === id)!;
    await phone.press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  expect(focusedId()).toBe(id);
}
async function pick(label: string) {
  const c = lib().chips!.find((x) => x.label === label)!;
  await focusOn(`chip:${c.key}`);
  await phone.press("ok");
}

describe("Library filter chips", () => {
  test("All, Shows, Films, then languages and genres with 3+ titles, most first", async () => {
    await start(household());
    expect(chips()).toEqual([
      "All",
      "Shows",
      "Films",
      "English",
      "Malayalam",
      "Tamil",
      "Drama",
      "Thriller",
    ]);
    expect(active()).toEqual(["All"]);
  });

  test("genre chips are capped at 8", async () => {
    const genres = named("G", 10);
    const specs = named("Fil", 10).flatMap((name) => [
      { name: `${name}1`, lang: "en", genres },
      { name: `${name}2`, lang: "en", genres },
      { name: `${name}3`, lang: "en", genres },
    ]);
    await start(specs);
    const genreChips = chips().filter((c) => /^G[A-J]$/.test(c));
    expect(genreChips).toHaveLength(8);
  });

  test("without details only Shows and Films appear", async () => {
    await start(undefined);
    expect(chips()).toEqual(["All", "Shows", "Films"]);
    expect(rowIds()).not.toContain("auto:genre:Drama");
    expect(rowIds().some((id) => id.startsWith("auto:"))).toBe(false);
  });

  test("Up from the first row reaches the chips, and the top strip sits above them", async () => {
    await start(household());
    const first = focusedId()!;
    expect(first.startsWith("shows:")).toBe(true);
    await phone.press("up");
    expect(focusedId()).toBe("chip:all");
    await phone.press("up");
    expect(focusedId()).toBe("settings");
    await phone.press("left");
    expect(focusedId()).toBe("search");
  });

  test("a language chip filters every row, episodes by show, and hides Folders", async () => {
    const arcane = join(root, "Arcane", "Arcane S01E01.mkv");
    const eng = join(root, "EngA.2020.mkv");
    const mal = join(root, "MalA.2020.mkv");
    await start(household(), {
      [arcane]: { duration: 2400, position: 600, at: 3 },
      [eng]: { duration: 6000, position: 600, at: 2 },
      [mal]: { duration: 6000, position: 600, at: 1 },
    });
    expect(lib().entries.length).toBeGreaterThan(0);
    await pick("Malayalam");
    expect(active()).toEqual(["Malayalam"]);
    expect(lib().entries).toEqual([]);
    expect(rowIds()).toEqual(["continue", "films", "recent"]);
    expect(row("continue").entries.map((e) => e.path)).toEqual([mal]);
    expect(row("films").entries.map((e) => e.title)).toEqual(named("Mal", 6));
    expect(h.screen.last.focusedId).toBe("chip:lang:ml");
    await phone.press("ok");
    expect(active()).toEqual(["All"]);
    await pick("English");
    expect(row("continue").entries.map((e) => e.path)).toEqual([arcane, eng]);
    expect(rowIds()).toContain("shows");
  });

  test("Shows, Films and genre chips filter; empty rows hide", async () => {
    await start(household());
    await pick("Shows");
    expect(rowIds()).toEqual(["shows", "recent"]);
    await pick("Films");
    expect(rowIds()).toEqual(["films", "recent"]);
    await pick("Thriller");
    expect(row("films").entries.map((e) => e.title)).toEqual(["MalA", "MalB", "MalC"]);
    expect(rowIds()).toEqual(["films", "recent"]);
  });

  test("OK on another chip replaces the active one", async () => {
    await start(household());
    await pick("Tamil");
    await pick("Drama");
    expect(active()).toEqual(["Drama"]);
  });

  test("Back clears the chip, then leaves the Library", async () => {
    await start(household());
    await pick("Tamil");
    await phone.press("back");
    expect(active()).toEqual(["All"]);
    expect(h.screen.last.viewKey).toBe("library");
    expect(focusedId()).toBe("chip:all");
    expect(lib().entries.length).toBeGreaterThan(0);
    await phone.press("back");
    expect(h.screen.last.viewKey).toBe("home");
  });

  test("the phone's where label names the active chip", async () => {
    await start(household());
    expect(phone.last?.where).toBe("Library");
    await pick("Malayalam");
    expect(phone.last?.where).toBe("Library · Malayalam");
  });
});

describe("Automatic rows", () => {
  test("after Films: top languages after the most common, and the top genre; A–Z", async () => {
    await start(household());
    expect(rowIds()).toEqual([
      "shows",
      "films",
      "auto:lang:ml",
      "auto:lang:ta",
      "auto:genre:Drama",
      "recent",
    ]);
    expect(row("auto:lang:ml").title).toBe("Malayalam films");
    expect(row("auto:lang:ta").title).toBe("Tamil films");
    expect(row("auto:lang:ml").entries.map((e) => e.title)).toEqual(named("Mal", 6));
    const drama = row("auto:genre:Drama");
    expect(drama.title).toBe("Drama");
    expect(drama.entries).toHaveLength(19);
    expect(drama.entries.map((e) => e.title)).toEqual(
      drama.entries.map((e) => e.title).sort((a, b) => a.localeCompare(b)),
    );
  });

  test("rows with fewer than 5 titles are left out; the cap is 20", async () => {
    const specs: Spec[] = [
      ...Array.from({ length: 22 }, (_, i) => ({
        name: `En${String(i).padStart(2, "0")}`,
        lang: "en",
        genres: ["Drama"],
      })),
      ...named("Fr", 4).map((name) => ({ name, lang: "fr", genres: ["Comedy"] })),
    ];
    await start(specs);
    expect(rowIds().filter((id) => id.startsWith("auto:"))).toEqual(["auto:genre:Drama"]);
    expect(row("auto:genre:Drama").entries).toHaveLength(20);
  });

  test("hidden while a chip is active", async () => {
    await start(household());
    await pick("Tamil");
    expect(rowIds().some((id) => id.startsWith("auto:"))).toBe(false);
  });
});
