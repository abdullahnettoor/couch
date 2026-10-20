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

const ep = (season: number, n: number) =>
  join(root, "Arcane", `Season ${season}`, `Arcane S0${season}E0${n}.mkv`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "couch-show-"));
  storeDir = mkdtempSync(join(tmpdir(), "couch-showstore-"));
  for (const [s, n] of [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 1],
    [2, 2],
  ] as const) {
    mkdirSync(join(root, "Arcane", `Season ${s}`), { recursive: true });
    writeFileSync(ep(s, n), "");
  }
  mkdirSync(join(root, "Arcane", "Extras"), { recursive: true });
  writeFileSync(join(root, "Arcane", "Extras", "Making of.mkv"), "");
  mkdirSync(join(root, "Heat"), { recursive: true });
  writeFileSync(join(root, "Heat", "Heat.mkv"), "");
});
afterEach(async () => {
  await h?.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

const watched = (...paths: string[]) =>
  Object.fromEntries(paths.map((p, i) => [p, { duration: 2400, watched: true, at: 10 + i }]));

async function start(
  history?: Record<string, unknown>,
  opts: { key?: boolean; candidates?: boolean } = {},
) {
  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  if (history) store.write("history", { items: history });
  h = await startHarness(store, opts.key ? { tmdbProjectKey: "eyJ.test.key" } : undefined);
  h.metadata.catalog.show.arcane = [
    { id: 94605, name: "Arcane", year: 2021, posterPath: "/arcane.jpg" },
    { id: 11, name: "Arcane: League", year: 2019, posterPath: "/x.jpg" },
  ];
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
async function openArcane() {
  await focusId("shows:show:arcane");
  await phone.press("ok");
  expect(screen().state.view).toBe("show");
}
const page = () => screen().show!;
const eof = () => h.player.emit({ type: "ended", reason: "eof" });
const loads = () => h.player.calls.filter((c) => c.call === "load").map((c) => c.args[0]);

describe("Show page primary button", () => {
  test("nothing watched: Play S1 E1, focus on that episode", async () => {
    await start();
    await openArcane();
    expect(page().primary).toBe("Play S1 E1");
    expect(focusedId()).toBe(ep(1, 1));
    expect((await phone.press("left")).where).toBe("Arcane");
    expect(focusedId()).toBe("play");
    await phone.press("ok");
    expect(loads()).toEqual([ep(1, 1)]);
  });

  test("partly watched: Play the next unwatched, across seasons", async () => {
    await start(watched(ep(1, 1), ep(1, 2), ep(1, 3)));
    await openArcane();
    expect(page().primary).toBe("Play S2 E1");
    expect(page().tabs.find((t) => t.selected)!.id).toBe("2");
    expect(focusedId()).toBe(ep(2, 1));
    await focusId("play");
    await phone.press("ok");
    expect(loads()).toEqual([ep(2, 1)]);
  });

  test("in progress: Resume, with the right episode", async () => {
    await start({
      ...watched(ep(1, 1)),
      [ep(1, 2)]: { position: 600, duration: 2400, at: 50 },
    });
    await openArcane();
    expect(page().primary).toBe("Resume S1 E2");
    expect(focusedId()).toBe(ep(1, 2));
    expect(page().episodes[1]!.progress!.left).toBe("30 min left");
    expect(page().episodes[0]!.watched).toBe(true);
    await focusId("play");
    await phone.press("ok");
    expect(h.player.calls.find((c) => c.call === "load")!.args[1]).toMatchObject({
      startSeconds: 600,
    });
  });

  test("everything watched: Play again from S1 E1 starts over", async () => {
    await start(watched(ep(1, 1), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2)));
    await openArcane();
    expect(page().primary).toBe("Play again from S1 E1");
    expect(focusedId()).toBe(ep(1, 1));
    await focusId("play");
    await phone.press("ok");
    expect(loads()).toEqual([ep(1, 1)]);
  });
});

describe("Season tabs and the list", () => {
  test("tabs in order with Extras last; focusing a tab switches the list", async () => {
    await start();
    await openArcane();
    expect(page().tabs.map((t) => t.label)).toEqual(["Season 1", "Season 2", "Extras"]);
    expect(page().meta).toEqual(["2 seasons", "5 episodes"]);
    expect(page().episodes.map((e) => e.number)).toEqual([1, 2, 3]);
    await phone.press("up");
    expect(focusedId()).toBe("tab:1");
    await phone.press("right");
    expect(focusedId()).toBe("tab:2");
    expect(page().episodes.map((e) => e.id)).toEqual([ep(2, 1), ep(2, 2)]);
    await phone.press("right");
    expect(page().episodes.map((e) => e.title)).toEqual(["Making of"]);
    await phone.press("down");
    expect(focusedId()).toBe(join(root, "Arcane", "Extras", "Making of.mkv"));
    await phone.press("ok");
    expect(loads()).toEqual([join(root, "Arcane", "Extras", "Making of.mkv")]);
  });

  test("Left from the list reaches the primary button, Right returns to the episode", async () => {
    await start();
    await openArcane();
    await phone.press("down");
    expect(focusedId()).toBe(ep(1, 2));
    await phone.press("left");
    expect(focusedId()).toBe("play");
    await phone.press("right");
    expect(focusedId()).toBe(ep(1, 1));
  });

  test("Fix match is hidden without a key", async () => {
    await start();
    await openArcane();
    expect(page().canFix).toBe(false);
    expect(screen().grid.some((g) => g.id === "fix")).toBe(false);
  });
});

describe("Back and return", () => {
  test("Back returns to the Library with focus on the show's tile", async () => {
    await start();
    await openArcane();
    await phone.press("back");
    expect(screen().state.view).toBe("library");
    expect(focusedId()).toBe("shows:show:arcane");
  });

  test("Back from a started video returns to the show page, same episode", async () => {
    await start();
    await openArcane();
    await phone.press("down");
    await phone.press("ok");
    expect(screen().state.view).toBe("player");
    h.player.emit({ type: "duration", seconds: 2400 });
    await phone.press("back");
    expect(screen().state.view).toBe("show");
    expect(focusedId()).toBe(ep(1, 2));
  });

  test("after an end the next episode is focused, across a season", async () => {
    await start(watched(ep(1, 1), ep(1, 2)));
    await openArcane();
    expect(focusedId()).toBe(ep(1, 3));
    await phone.press("ok");
    h.player.emit({ type: "duration", seconds: 2400 });
    eof();
    expect(screen().state.controls).toBe("next");
    await phone.press("back");
    expect(screen().state.view).toBe("show");
    expect(page().tabs.find((t) => t.selected)!.id).toBe("2");
    expect(focusedId()).toBe(ep(2, 1));
    expect(page().primary).toBe("Play S2 E1");
  });
});

describe("Fix match", () => {
  test("lists the top candidates plus video frames; OK picks", async () => {
    await start(undefined, { key: true });
    await openArcane();
    expect(page().canFix).toBe(true);
    await focusId("fix");
    await phone.press("ok");
    expect(screen().state.view).toBe("fixMatch");
    await phone.waitFor(() => !screen().fixMatch!.loading);
    expect(screen().fixMatch!.options.map((o) => o.name)).toEqual(["Arcane", "Arcane: League"]);
    expect(screen().grid.map((g) => g.label)).toEqual([
      "Arcane",
      "Arcane: League",
      "Use video frames",
    ]);
    await phone.press("down");
    await phone.press("ok");
    expect(screen().state.view).toBe("show");
    await h.app.core.details.settled();
    expect(h.app.core.details.detailsFor("show:arcane")?.tmdbId).toBe(11);
  });

  test("Back from the list returns to the show page; frames can be picked", async () => {
    await start(undefined, { key: true });
    await openArcane();
    await focusId("fix");
    await phone.press("ok");
    await phone.waitFor(() => !screen().fixMatch!.loading);
    await phone.press("back");
    expect(screen().state.view).toBe("show");
    await phone.press("ok");
    await phone.waitFor(() => !screen().fixMatch!.loading);
    await focusId("frames");
    await phone.press("ok");
    expect(h.app.core.details.usesFrames("show:arcane")).toBe(true);
  });
});
