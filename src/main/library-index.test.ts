import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { History } from "./core/history.ts";
import { cleanFolderName, parseTitle } from "./core/library.ts";
import { MediaLibrary } from "./core/media-library.ts";
import { FileStore, type Store } from "./ports/store.ts";
import { startHarness } from "./testing/harness.ts";

let root: string;
let storeDir: string;
const clock = { now: () => 1_000_000 };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-index-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-indexstore-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const touch = (...parts: string[]) => {
  const p = join(root, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "");
  return p;
};
const scanned = async (store: Store = new FileStore(storeDir)) => {
  const lib = new MediaLibrary(store, clock);
  await lib.refresh([root]);
  return lib;
};

function spec() {
  for (const s of [1, 2])
    for (const e of [1, 2]) touch("Arcane", `Arcane S0${s}`, `Arcane S0${s}E0${e}.mkv`);
  touch("Avatar", "Avatar.The.Last.Airbender", "S01", "S01E01.Aang.mkv");
  touch("Avatar", "Avatar.The.Last.Airbender", "S01", "S01E02.Katara.mkv");
  touch("Avatar", "Avatar.The.Last.Airbender", "Extras", "Commentary.mkv");
  touch("Avatar", "Avatar TLA S02E01.mkv");
  touch("Avatar", "Korra", "Korra S01E01.mkv");
  touch("Vox", "The Legend of Vox Machina S01E01.mkv");
  touch("Vox", "The Legend of Vox Machina (2022) S01E02.mkv");
  touch("Arcane", "Behind the scenes", "Animatic.mkv");
  touch("Arcane", "Arcane S01", "Menu Art.mkv");
  touch("Sing", "Sing (2016)", "Sing.2016.1080p.mkv");
  touch("Sing", "Sing 2 (2021)", "Sing.2.2021.1080p.mkv");
  touch("Wrapper (2014)", "Wrapper.2014.1080p.BluRay.x264.mkv");
  touch("Wrapper (2014)", "Subs", "English.srt");
  touch("Kung-Fu-Panda-4.mkv");
  touch("Minions The Rise of Gru-2022.mkv");
  touch("Lessons", "01 Intro.mkv");
  touch("Lessons", "02 Basics.mkv");
  touch("Lessons", "03 Advanced.mkv");
}

describe("title cleanup", () => {
  test("hyphen- and dot-joined tags and years", () => {
    expect(parseTitle("Kung-Fu-Panda-4.mkv").name).toBe("Kung Fu Panda 4");
    expect(parseTitle("Minions The Rise of Gru-2022.mkv").name).toBe(
      "Minions The Rise of Gru (2022)",
    );
    expect(parseTitle("Heat-1995-1080p-BluRay.mkv").name).toBe("Heat (1995)");
    expect(parseTitle("Spider-Man 2002.mkv").name).toBe("Spider-Man (2002)");
    expect(cleanFolderName("Kung-Fu-Panda-4")).toBe("Kung Fu Panda 4");
  });
});

describe("grouping", () => {
  test("the spec's cases", async () => {
    spec();
    const lib = await scanned();
    expect(lib.shows().map((s) => s.name)).toEqual([
      "Arcane",
      "Avatar The Last Airbender",
      "Korra",
      "Lessons",
      "The Legend of Vox Machina",
    ]);
    const arcane = lib.shows().find((s) => s.name === "Arcane")!;
    expect(arcane.seasons.map((s) => [s.number, s.episodes.length])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(arcane.extras.map((e) => e.title).sort()).toEqual(["Animatic", "Menu Art"]);
    expect(lib.show("show:avatar-the-last-airbender")!.seasons.map((s) => s.number)).toEqual([
      1, 2,
    ]);
    const avatar = lib.shows().find((s) => s.name === "Avatar The Last Airbender")!;
    expect(avatar.seasons[0]!.episodes.map((e) => e.title)).toEqual(["Aang", "Katara"]);
    expect(avatar.extras.map((e) => e.title)).toEqual(["Commentary"]);
    const vox = lib.shows().find((s) => s.name === "The Legend of Vox Machina")!;
    expect(vox.episodeCount).toBe(2);
    expect(vox.year).toBe(2022);
    const lessons = lib.shows().find((s) => s.name === "Lessons")!;
    expect(lessons.seasons[0]!.episodes.map((e) => e.title)).toEqual(
      ["01 Intro", "02 Basics", "03 Advanced"].map((t) => t),
    );
    expect(lib.films().map((f) => f.title)).toEqual([
      "Kung Fu Panda 4",
      "Minions The Rise of Gru (2022)",
      "Sing (2016)",
      "Sing 2 (2021)",
      "Wrapper (2014)",
    ]);
  });

  test("extras are not films, and AppleDouble and sample files are skipped", async () => {
    touch("Show", "Show S01E01.mkv");
    touch("Show", "Featurettes", "Making of.mkv");
    touch("Movies", "._Film.mkv");
    touch("Movies", "Film.mkv");
    touch("Movies", "Film-sample.mkv");
    touch("Orphan", "Extras", "Bonus clip.mkv");
    const lib = await scanned();
    expect(lib.films().map((f) => f.title)).toEqual(["Film"]);
    expect(lib.show("show:show")!.extras.map((e) => e.title)).toEqual(["Making of"]);
  });

  test("a series name in the file beats the folder; episodes without a season are season 1", async () => {
    touch("Misc", "Dark.1x01.mkv");
    touch("Misc", "Dark.1x02.mkv");
    const lib = await scanned();
    expect(lib.shows().map((s) => s.name)).toEqual(["Dark"]);
  });
});

describe("grouping as the Library shows it", () => {
  test("the Shows and Films rows list the spec's titles", async () => {
    spec();
    const store = new FileStore(storeDir);
    store.write("library", { folders: [root] });
    const h = await startHarness(store);
    try {
      await h.app.core.library.settled();
      const phone = await h.connectPhone();
      await phone.press("home");
      for (let i = 0; i < 40 && h.screen.last.focusedId !== "library"; i++) {
        const { grid, focusedId } = h.screen.last;
        const cur = grid.find((x) => x.id === focusedId)!;
        const t = grid.find((x) => x.id === "library")!;
        await phone.press(
          t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left",
        );
      }
      await phone.press("ok");
      const rows = h.screen.last.library!.rows!;
      const titles = (id: string) => rows.find((r) => r.id === id)!.entries.map((e) => e.title);
      expect(titles("shows")).toEqual([
        "Arcane",
        "Avatar The Last Airbender",
        "Korra",
        "Lessons",
        "The Legend of Vox Machina",
      ]);
      expect(titles("films")).toEqual([
        "Kung Fu Panda 4",
        "Minions The Rise of Gru",
        "Sing",
        "Sing 2",
        "Wrapper",
      ]);
    } finally {
      await h.stop();
    }
  });
});

describe("index", () => {
  test("new and deleted files are picked up on the next scan; first-seen is kept", async () => {
    const a = touch("Film A.mkv");
    let now = 100;
    const lib = new MediaLibrary(new FileStore(storeDir), { now: () => now });
    await lib.refresh([root]);
    expect(lib.films().map((f) => f.title)).toEqual(["Film A"]);
    now = 5000;
    touch("Film B.mkv");
    rmSync(a);
    await lib.refresh([root]);
    expect(lib.films().map((f) => f.title)).toEqual(["Film B"]);
    expect(lib.films()[0]!.addedAt).toBe(5000);
    touch("Film A.mkv");
    now = 9000;
    await lib.refresh([root]);
    expect(lib.recentlyAdded().map((r) => r.film!.title)).toEqual(["Film A", "Film B"]);
  });

  test("the first scan uses file dates, so a whole existing library is not all new", async () => {
    const p = touch("Old.mkv");
    utimesSync(p, 500, 500);
    const lib = await scanned();
    expect(lib.films()[0]!.addedAt).toBe(500_000);
  });

  test("a missing drive keeps its entries, marked missing", async () => {
    touch("Film A.mkv");
    touch("Show", "Show S01E01.mkv");
    const lib = await scanned();
    rmSync(root, { recursive: true });
    await lib.refresh([root]);
    expect(lib.films()[0]).toMatchObject({ title: "Film A", missing: true });
    expect(lib.show("show:show")).toMatchObject({ missing: true });
    mkdirSync(root);
    await lib.refresh([root]);
    expect(lib.films()).toEqual([]);
  });

  test("a removed Library folder drops its entries", async () => {
    touch("Film A.mkv");
    const lib = await scanned();
    await lib.refresh([]);
    expect(lib.films()).toEqual([]);
  });

  test("the index survives a restart and is read before any scan", async () => {
    touch("Film A.mkv");
    const store = new FileStore(storeDir);
    await scanned(store);
    const again = new MediaLibrary(new FileStore(storeDir), clock);
    expect(again.films().map((f) => f.title)).toEqual(["Film A"]);
  });

  test("the core draws from the saved index at once and refreshes at start and when the Library opens", async () => {
    touch("Film A.mkv");
    const store = new FileStore(storeDir);
    store.write("library", { folders: [root] });
    let h = await startHarness(store);
    await h.app.core.library.settled();
    expect(h.app.core.library.films().map((f) => f.title)).toEqual(["Film A"]);
    await h.stop();
    touch("Film B.mkv");
    h = await startHarness(store);
    expect(h.app.core.library.films().map((f) => f.title)).toEqual(["Film A"]);
    await h.app.core.library.settled();
    expect(h.app.core.library.films().map((f) => f.title)).toEqual(["Film A", "Film B"]);
    touch("Film C.mkv");
    const phone = await h.connectPhone();
    await phone.press("right");
    await phone.press("ok");
    await phone.press("ok");
    await h.app.core.library.settled();
    expect(h.app.core.library.films().map((f) => f.title)).toContain("Film C");
    await h.stop();
  });
});

describe("order and Next up", () => {
  function seasons() {
    for (const s of [1, 2])
      for (const e of [8, 9, 10]) touch("Long", `Long S0${s}E${String(e).padStart(2, "0")}.mkv`);
    touch("Long", "Long S02E02.mkv");
  }
  const path = (s: number, e: number) =>
    join(root, "Long", `Long S0${s}E${String(e).padStart(2, "0")}.mkv`);

  test("the next episode crosses seasons", async () => {
    seasons();
    const lib = await scanned();
    expect(lib.nextEpisode(path(1, 9))!.episode).toBe(10);
    expect(lib.nextEpisode(path(1, 10))).toMatchObject({ season: 2, episode: 2 });
    expect(lib.nextEpisode(path(2, 10))).toBeUndefined();
    expect(lib.nextEpisode(join(root, "nothing.mkv"))).toBeUndefined();
  });

  test("Next up is the episode after the furthest watched one", async () => {
    seasons();
    touch("Other", "Other S01E01.mkv");
    const lib = await scanned();
    const history = new History(new FileStore(storeDir));
    expect(lib.nextUp(history)).toEqual([]);
    history.save(path(1, 8), 0, 0, 10, true);
    history.save(path(1, 10), 0, 0, 20, true);
    history.save(path(1, 9), 0, 0, 30, true);
    expect(
      lib.nextUp(history).map((n) => [n.show.name, n.episode.season, n.episode.episode]),
    ).toEqual([["Long", 2, 2]]);
    history.save(join(root, "Other", "Other S01E01.mkv"), 300, 3000, 40);
    expect(lib.nextUp(history).map((n) => n.show.name)).toEqual(["Other", "Long"]);
    for (const [s, e] of [
      [2, 2],
      [2, 8],
      [2, 9],
      [2, 10],
    ] as const)
      history.save(path(s, e), 0, 0, 50, true);
    expect(lib.nextUp(history).map((n) => n.show.name)).toEqual(["Other"]);
  });
});

describe("Cobra Kai's real tree", () => {
  const counts = [10, 13, 10, 10, 10, 12];
  const name = (s: number, e: number) =>
    [
      `Cobra_Kai_S1 Ep_${e}_720P.mp4`,
      `Cobra_Kai_S2E${e}_720P.mp4`,
      `CobraKai_S03e${String(e).padStart(2, "0")}_720p_W3B_DL_x264.mkv`,
      `Cobra.Kai.S04E${String(e).padStart(2, "0")}.WEBRip.x264-ION10.mp4`,
      `Cobra.kai.s05e${String(e).padStart(2, "0")}.long.long.way.from.home.mkv`,
      `Cobra.Kai.S06E${String(e).padStart(2, "0")}.1080p.NF-[y2flix.cc].mp4`,
    ][s - 1]!;

  test("one show, six seasons, no films", async () => {
    counts.forEach((n, i) => {
      for (let e = 1; e <= n; e++)
        touch("Series", "Cobra.Kai", `Cobra Kai S0${i + 1}`, name(i + 1, e));
    });
    touch("Series", "Cobra.Kai", "Cobra Kai S01", "Cobra_Kai_S1Ep10_720P.mp4.bak.txt");
    const lib = await scanned();
    expect(lib.shows().map((s) => s.name)).toEqual(["Cobra Kai"]);
    const show = lib.shows()[0]!;
    expect(show.seasons.map((s) => [s.number, s.episodes.length])).toEqual(
      counts.map((n, i) => [i + 1, n]),
    );
    expect(show.episodeCount).toBe(65);
    expect(lib.films()).toEqual([]);
  });

  test("marker styles", () => {
    expect(parseTitle("Cobra_Kai_S1 Ep_4_-720P.mp4")).toMatchObject({ season: 1, episode: 4 });
    expect(parseTitle("Show S01 Ep01.mkv")).toMatchObject({
      series: "Show",
      season: 1,
      episode: 1,
    });
    expect(parseTitle("Show Season 2 Episode 5.mkv")).toMatchObject({
      series: "Show",
      season: 2,
      episode: 5,
    });
    expect(parseTitle("Ep 3.mkv")).toMatchObject({ episode: 3 });
    expect(parseTitle("Ep 3.mkv").season).toBeUndefined();
  });

  test("seasonless episode files take the season from their folder; elsewhere they are films", async () => {
    touch("Shows", "Dark Matter", "Season 2", "Ep 1.mkv");
    touch("Shows", "Dark Matter", "Season 2", "E02.mkv");
    touch("Loose", "Episode 1 The Movie.mkv");
    const lib = await scanned();
    const show = lib.shows().find((s) => s.name === "Dark Matter")!;
    expect(show.seasons.map((s) => [s.number, s.episodes.length])).toEqual([[2, 2]]);
    expect(lib.films().map((f) => f.title)).toEqual(["Episode 1 The Movie"]);
  });

  test("Squid Game across two top-level season folders is one show", async () => {
    touch("Squid.Game.S02", "Squid.Game.S02E01.mkv");
    touch("Squid.Game.S03", "Squid.Game.S03E01.mkv");
    const lib = await scanned();
    expect(lib.shows().map((s) => [s.name, s.seasons.length])).toEqual([["Squid Game", 2]]);
  });
});
