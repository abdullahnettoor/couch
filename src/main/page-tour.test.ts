/**
 * The recorded tour: drives Couch through every Page and records, after each command,
 * the Screen payload (without `now`), the phone's snapshot and the Interface sounds played.
 * It fails on any difference from `page-tour.json`, so a refactor of the Pages can prove
 * the household sees, and hears, nothing different.
 *
 * To change what Couch shows on purpose, rewrite the recording and review the diff:
 *   COUCH_UPDATE_TOUR=1 vp test run src/main/page-tour.test.ts
 *
 * Normalised so runs agree: temp folders (`<library>`, `<store>`, `<thumbs>`, `<art>`),
 * the Remote server's port and the pairing key. `now` is left out of the Screen payload
 * (it is the wall clock). The fake clock fixes every other time the core reads.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import type { Command, GridItem, RemoteSnapshot, View } from "../shared/protocol.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

const RECORDING = join(import.meta.dirname, "page-tour.json");
const UPDATE = process.env.COUCH_UPDATE_TOUR === "1";

/** Every Page the tour has to visit. Adding a View to the type breaks this object until it is listed. */
const ALL_VIEWS = {
  home: true,
  app: true,
  appError: true,
  library: true,
  folder: true,
  player: true,
  settings: true,
  settingsRemotes: true,
  settingsLibrary: true,
  settingsApps: true,
  addPhone: true,
  libraryFolders: true,
  details: true,
  soundOutput: true,
  settingsHome: true,
  about: true,
  addons: true,
  credits: true,
  show: true,
  fixMatch: true,
  librarySearch: true,
} satisfies Record<View, true>;

/** What changed since the step before, field by field: the first step is whole. The icons make a full copy of every step megabytes. */
interface Change {
  set: Record<string, unknown>;
  removed: string[];
}

interface Entry {
  step: string;
  screen: Change;
  phone: Change;
  sounds: unknown[];
}

const MIN = 60_000;
const BEARER = "eyJ.test.key";

let base: string;
let root: string;
let storeDir: string;
let h: Harness;
let phone: FakePhone;
const visited = new Set<string>();
const recording: Entry[] = [];
let soundsSeen = 0;
let normalise: (value: unknown) => unknown;

let fileNo = 0;
/** Creates an empty file with a fixed, distinct modified time, so "recently added" never depends on the disk's speed. */
const touch = (...parts: string[]) => {
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  const file = join(root, ...parts);
  writeFileSync(file, "");
  const when = new Date(Date.UTC(2026, 0, 1) + ++fileNo * 86_400_000);
  utimesSync(file, when, when);
};

function makeNormaliser(replacements: Array<[string, string]>) {
  const ordered = replacements.filter(([from]) => from).sort((a, b) => b[0].length - a[0].length);
  return (value: unknown): unknown => {
    let text = JSON.stringify(value) ?? "null";
    for (const [from, to] of ordered) text = text.split(from).join(to);
    return JSON.parse(text);
  };
}

const screen = () => h.screen.last;
const view = () => screen().state.view;

/** Sends one command, lets everything it caused finish, and records what the Screen, phone and speakers got. */
async function cmd(step: string, command: Command["command"] | Command): Promise<void> {
  phone.send(command);
  await settle();
  record(step);
}

/** A change that doesn't come from a command (time passing, an App reporting in). */
async function event(step: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  await settle();
  record(step);
}

async function settle(): Promise<void> {
  await h.settle();
  await phone.settle();
  await h.settle();
}

const last: { screen: Record<string, unknown>; phone: Record<string, unknown> } = {
  screen: {},
  phone: {},
};

function change(kind: "screen" | "phone", now: Record<string, unknown>): Change {
  const before = last[kind];
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(now))
    if (JSON.stringify(value) !== JSON.stringify(before[key])) set[key] = value;
  const removed = Object.keys(before).filter((key) => !(key in now));
  last[kind] = now;
  return { set, removed };
}

function record(step: string): void {
  const { now: _now, ...payload } = screen();
  visited.add(view());
  const sounds = h.screen.sounds.slice(soundsSeen);
  soundsSeen = h.screen.sounds.length;
  recording.push({
    step,
    screen: change("screen", normalise(payload) as Record<string, unknown>),
    phone: change("phone", normalise(phone.last as RemoteSnapshot) as Record<string, unknown>),
    sounds: normalise(sounds) as unknown[],
  });
}

/** Moves focus to an item by D-pad (one recorded step per press), then stops. */
async function focus(id: string, label = id): Promise<void> {
  const there = () => {
    const now = screen().grid.find((g) => g.id === screen().focusedId);
    return screen().focusedId === id || now?.label === id;
  };
  for (let i = 0; i < 80 && !there(); i++) {
    const { grid, focusedId } = screen();
    const cur = grid.find((g: GridItem) => g.id === focusedId)!;
    const target = grid.find((g: GridItem) => g.id === id) ?? grid.find((g) => g.label === id);
    expect(target, `no item ${id} in ${view()}: ${grid.map((g) => g.id).join(", ")}`).toBeTruthy();
    const dir =
      target!.r > cur.r ? "down" : target!.r < cur.r ? "up" : target!.c > cur.c ? "right" : "left";
    await cmd(`${label}: ${dir}`, dir);
  }
  expect(there(), `focus ${id} in ${view()}`).toBe(true);
}

async function open(id: string, label = id): Promise<void> {
  await focus(id, label);
  await cmd(`${label}: ok`, "ok");
}

const back = (step: string) => cmd(step, "back");

beforeAll(async () => {
  // The Library's name is the folder's, and its tile hue comes from the name: keep it fixed.
  base = mkdtempSync(join(tmpdir(), "couch-tour-"));
  root = join(base, "Media");
  mkdirSync(root);
  storeDir = mkdtempSync(join(tmpdir(), "couch-tour-store-"));
  for (const f of ["Heat (1995)/Heat.1995.mkv", "Dune (2021)/Dune.2021.mkv", "Alien.1979.mkv"])
    touch("Movies", ...f.split("/"));
  for (const [s, n] of [
    [1, 1],
    [1, 2],
    [2, 1],
  ] as const)
    touch("Shows", "Arcane", `Season ${s}`, `Arcane S0${s}E0${n}.mkv`);
  touch("Shows", "Arcane", "Extras", "Making of.mkv");
  touch("Home videos", "2024", "Holiday", "Beach.mp4");
  touch("Home videos", "2024", "Birthday.mp4");
  touch("Home videos", "Garden.mp4");

  const store = new FileStore(storeDir);
  store.write("library", { folders: [root] });
  const clock = Date.UTC(2026, 9, 20, 8, 30, 0);
  store.write("history", {
    items: {
      [join(root, "Movies", "Heat (1995)", "Heat.1995.mkv")]: {
        position: 1800,
        duration: 10200,
        at: clock - 3 * 3600_000,
      },
      [join(root, "Shows", "Arcane", "Season 1", "Arcane S01E01.mkv")]: {
        position: 600,
        duration: 2400,
        at: clock - 2 * 3600_000,
      },
      [join(root, "Movies", "Alien.1979.mkv")]: {
        duration: 7000,
        watched: true,
        at: clock - 24 * 3600_000,
      },
    },
  });
  h = await startHarness(store, { tmdbProjectKey: BEARER });
  h.metadata.catalog.show.arcane = [
    { id: 94605, name: "Arcane", year: 2021, posterPath: "/arcane.jpg" },
    { id: 11, name: "Arcane: League", year: 2019, posterPath: "/x.jpg" },
  ];
  await h.app.core.library.settled();
  await h.app.core.details.settled();
  phone = await h.connectPhone();
  const port = String(h.app.remote.port);
  const key = h.pairingKey();
  normalise = makeNormaliser([
    [root, "<library>"],
    [storeDir, "<store>"],
    [h.thumbDir, "<thumbs>"],
    [h.art.dir, "<art>"],
    [`127.0.0.1:${port}`, "<host>"],
    [`:${port}`, ":<port>"],
    [encodeURIComponent(key), "<key>"],
    [key, "<key>"],
  ]);
  soundsSeen = h.screen.sounds.length;
  await tour();
}, 60_000);

afterAll(async () => {
  await h?.stop();
  rmSync(base, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

describe("the recorded tour of every Page", () => {
  test("visits every Page", async () => {
    expect([...visited].sort()).toEqual(Object.keys(ALL_VIEWS).sort());
  });

  test("matches page-tour.json", () => {
    const text = `${JSON.stringify(recording, null, 1)}\n`;
    if (UPDATE) {
      writeFileSync(RECORDING, text);
      return;
    }
    let expected: unknown;
    try {
      expected = JSON.parse(readFileSync(RECORDING, "utf8"));
    } catch {
      throw new Error(
        "page-tour.json is missing. Record it with: COUCH_UPDATE_TOUR=1 vp test run src/main/page-tour.test.ts",
      );
    }
    const actual = JSON.parse(text) as Entry[];
    const old = expected as Entry[];
    const at = actual.findIndex((e, i) => JSON.stringify(e) !== JSON.stringify(old[i]));
    const message = [
      "A Page, the phone or an Interface sound changed from the recorded tour",
      at >= 0 ? ` (first at step ${at}: "${actual[at]!.step}")` : "",
      actual.length !== old.length ? ` (${old.length} steps recorded, ${actual.length} now)` : "",
      ". If the change is on purpose, rewrite the recording and review the diff:",
      " COUCH_UPDATE_TOUR=1 vp test run src/main/page-tour.test.ts",
    ].join("");
    expect(actual, message).toEqual(old);
  });
});

async function tour(): Promise<void> {
  const expectView = (v: View) => expect(view(), `expected ${v}`).toBe(v);
  const continueTile = () =>
    screen().grid.find((g) => g.r === 2 && g.c >= 3 && g.id.includes("Arcane S01E01"))!.id;

  // Home
  await event("start on Home", () => {});
  await focus(continueTile(), "Continue watching");
  await focus("fromstart", "From start");
  await focus("resume", "Resume");
  await cmd("Continue watching: Resume", "ok");
  expectView("player");
  await event("Resume starts the video", () => h.player.emit({ type: "duration", seconds: 2400 }));
  await back("Back stops the video");
  expectView("home");
  await cmd("Home button on Home", "home");
  await event("ambient Home after 2 minutes", () => h.clock.advance(2 * MIN));
  await cmd("input wakes ambient Home", "left");
  await event("YouTube reports a title", () =>
    h.youtube.emit({
      type: "playback",
      playback: {
        position: 300,
        duration: 3000,
        paused: false,
        title: "Cat video",
        resume: "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=300",
      },
    }),
  );
  await event("YouTube's title is remembered", () =>
    h.youtube.emit({ type: "playback", playback: undefined }),
  );
  const appTitle = h.screen.last.homeVideos!.find((v) => v.app)!.path;
  await focus(appTitle, "Continue watching: App title");
  await focus("fromstart", "App title: From start");
  await focus("resume", "App title: Resume");

  // Library root, a chip, a folder and a sub-folder
  await open("library", "Library tile");
  expectView("library");
  await event("Library settles", () => {});
  await cmd("Library: right", "right");
  await cmd("Library: down", "down");
  await cmd("Library: down", "down");
  await cmd("Library: down", "down");
  await cmd("Library: up", "up");
  await cmd("Library: left", "left");
  await focus("search", "Library search");
  await cmd("Library search: ok", "ok");
  expectView("librarySearch");
  await cmd("search: typeOpen", "typeOpen");
  await cmd("search: text", { command: "typeText", args: { text: "arc" } });
  await event("search: results settle", () => h.clock.advance(150));
  await cmd("search: submit", "typeSubmit");
  await back("search: Back");
  expectView("library");
  await open("chip:films", "chip Films");
  await open("chip:all", "chip All");
  await focus(root, "Folders row");
  await cmd("Folders row: ok", "ok");
  expectView("folder");
  const sub = (...parts: string[]) => join(root, ...parts);
  await open(sub("Home videos"), "folder Home videos");
  expectView("folder");
  await open(sub("Home videos", "2024"), "sub-folder 2024");
  expectView("folder");
  await back("sub-folder: Back");
  expectView("folder");
  await back("folder: Back");
  expectView("folder");
  await back("root folder: Back");
  expectView("library");

  // A show, its tabs, Fix match, playback
  await open("shows:show:arcane", "show Arcane");
  expectView("show");
  await open("tab:2", "show tab 2");
  await open("tab:extras", "show tab Extras");
  await open("tab:1", "show tab 1");
  await open("fix", "Fix match");
  expectView("fixMatch");
  await phone.waitFor(() => !screen().fixMatch!.loading);
  await event("Fix match: candidates loaded", () => {});
  await cmd("Fix match: down", "down");
  await back("Fix match: Back");
  expectView("show");
  await back("show: Back");
  expectView("library");
  await focus("shows:show:arcane", "show Arcane");
  await cmd("Library: menu opens Fix match", "menu");
  expectView("fixMatch");
  await back("Fix match from the Library: Back");
  expectView("library");

  // Library playback: controls shown, then hidden
  await open("shows:show:arcane", "show Arcane");
  await open("play", "Play");
  expectView("player");
  await event("playback: duration", () => h.player.emit({ type: "duration", seconds: 2400 }));
  await event("playback: controls hide after a while", () => h.clock.advance(10_000));
  await cmd("playback: OK shows the controls", "ok");
  await cmd("playback: right", "right");
  await cmd("playback: down", "down");
  await cmd("playback: up", "up");
  await event("playback: controls hide again", () => h.clock.advance(10_000));
  await back("playback: Back with the controls hidden shows them");
  expectView("player");
  await back("playback: Back stops the video");
  expectView("show");
  await back("show: Back after playback");
  expectView("library");

  // Settings and each of its pages
  await cmd("Home", "home");
  expectView("home");
  await open("settings", "gear");
  expectView("settings");
  await open("Remotes and Devices");
  expectView("settingsRemotes");
  await open("Add a phone");
  expectView("addPhone");
  await back("Add phone: Back");
  await back("Remotes: Back");
  expectView("settings");
  await open("Library");
  expectView("settingsLibrary");
  await open("Library folders");
  expectView("libraryFolders");
  await cmd("Library folders: down", "down");
  await back("Library folders: Back");
  await open("Show and film details");
  expectView("details");
  await cmd("details: down", "down");
  await open("Credits");
  expectView("credits");
  await back("Credits: Back");
  expectView("details");
  await back("details: Back");
  await back("Library settings: Back");
  expectView("settings");
  await open("Sound output");
  expectView("soundOutput");
  await open("Interface sounds", "Interface sounds off");
  await cmd("Interface sounds: on again", "ok");
  await back("Sound output: Back");
  await open("Apps");
  expectView("settingsApps");
  await open("YouTube", "Apps: YouTube menu");
  await open("Add-ons");
  expectView("addons");
  await cmd("Add-ons: ok toggles one", "ok");
  await cmd("Add-ons: down", "down");
  await back("Add-ons: Back");
  expectView("settingsApps");
  await back("Apps menu: Back");
  await back("Apps: Back");
  expectView("settings");
  await open("Home", "Settings: Home");
  expectView("settingsHome");
  await cmd("Settings Home: ok", "ok");
  await cmd("Settings Home: down", "down");
  await cmd("Settings Home: ok", "ok");
  await back("Settings Home: Back");
  await open("About");
  expectView("about");
  await event("About: an update is found", () => h.updater.available());
  await event("About: the update is ready", () => h.updater.download("Couch 0.2.1"));
  await back("About: Back");
  await back("Settings: Back");
  expectView("home");

  // Apps: opened, left with Back, and the error page
  await open("youtube", "YouTube tile");
  expectView("app");
  await event("YouTube: at its home", () => h.youtube.emit({ type: "route", home: true }));
  await back("YouTube: Back asks Leave YouTube?");
  expectView("app");
  await cmd("Leave YouTube?: right", "right");
  await cmd("Leave YouTube?: Go to Home", "ok");
  expectView("home");
  await open("youtube", "YouTube tile again");
  await event("YouTube: failed to load", () => h.youtube.emit({ type: "failed" }));
  expectView("appError");
  await back("App error: Back");
  expectView("home");

  // Review round: paths the first tour missed
  const tile = (name: string) => {
    const t = screen().grid.find((g) => g.id.includes(name));
    if (!t)
      throw new Error(
        `no ${name}: ${screen()
          .grid.map((g) => g.id)
          .join(" | ")}`,
      );
    return t.id;
  };

  await cmd("Home button before Back-from-playback checks", "home");
  await focus(tile("Arcane S01E01"), "Continue watching again");
  await focus("resume", "Resume again");
  await cmd("Resume again: ok", "ok");
  expectView("player");
  await event("Resume again: duration", () => h.player.emit({ type: "duration", seconds: 2400 }));
  await back("Back from playback started on Home");
  expectView("home");
  await event("the ambient delay passes with no Home press", () => h.clock.advance(2 * MIN));
  await cmd("input after the delay", "left");

  await focus(tile("Arcane S01E01"), "Arcane tile before removal");
  await cmd("Arcane tile: menu", "menu");
  await cmd("Arcane tile: Remove from Continue watching", "ok");
  await focus(tile("Heat.1995"), "Heat tile");
  await focus("resume", "Heat: Resume");
  await cmd("Heat: menu", "menu");
  await cmd("Heat: menu down", "down");
  await cmd("Heat: Fix match", "ok");
  expectView("fixMatch");
  await phone.waitFor(() => !screen().fixMatch!.loading);
  await event("Fix match from Home: loaded", () => {});
  await back("Fix match from Home (Resume): Back");
  expectView("home");
  await focus("fromstart", "Heat: From start");
  await cmd("Heat: menu from From start", "menu");
  await cmd("Heat: menu down", "down");
  await cmd("Heat: Fix match", "ok");
  expectView("fixMatch");
  await phone.waitFor(() => !screen().fixMatch!.loading);
  await back("Fix match from Home (From start): Back");
  expectView("home");
  await focus(tile("Heat.1995"), "Heat tile again");
  await cmd("Heat tile: menu", "menu");
  await cmd("Heat tile: menu down", "down");
  await cmd("Heat tile: Fix match", "ok");
  await phone.waitFor(() => !screen().fixMatch!.loading);
  await back("Fix match from Home (tile): Back");
  expectView("home");

  // Library search, a show, Back
  await open("library", "Library tile again");
  await focus("search", "Library search again");
  await cmd("Library search again: ok", "ok");
  expectView("librarySearch");
  await cmd("search again: typeOpen", "typeOpen");
  await cmd("search again: text", { command: "typeText", args: { text: "arc" } });
  await event("search again: results settle", () => h.clock.advance(150));
  await cmd("search again: submit", "typeSubmit");
  await focus("search:shows:show:arcane", "search result Arcane");
  await cmd("search result: ok", "ok");
  expectView("show");
  await back("show from search: Back");
  await back("search: Back again");

  // Applying a Fix match
  await open("shows:show:arcane", "show Arcane again");
  await open("fix", "Fix match again");
  await phone.waitFor(() => !screen().fixMatch!.loading);
  await cmd("Fix match: down to the second", "down");
  await cmd("Fix match: apply", "ok");
  await event("Fix match applied", () => {});
  await back("show: Back after applying");
  expectView("library");

  // Folder playback
  await focus(root, "Folders row again");
  await cmd("Folders row again: ok", "ok");
  await open(sub("Home videos"), "folder Home videos again");
  await open(sub("Home videos", "Garden.mp4"), "Garden");
  expectView("player");
  await event("folder playback: duration", () => h.player.emit({ type: "duration", seconds: 600 }));
  await back("folder playback: Back shows controls");
  await back("folder playback: Back stops");
  await event("folder playback: settled", () => {});

  // Up next and the end of a video
  await cmd("Home before Up next", "home");
  await open("library", "Library tile third");
  await open("shows:show:arcane", "show Arcane third");
  await open("play", "Play third");
  expectView("player");
  await event("Up next: duration", () => h.player.emit({ type: "duration", seconds: 2400 }));
  await cmd("Up next: down", "down");
  await cmd("Up next: right", "right");
  await back("Up next: Back to the dock");
  await cmd("Up next: down again", "down");
  await cmd("Up next: right again", "right");
  await cmd("Up next: play the chosen", "ok");
  await event("next video: duration", () => h.player.emit({ type: "duration", seconds: 2400 }));
  await event("video ends", () => h.player.emit({ type: "ended", reason: "eof" }));
  await event("end card settles", () => h.clock.advance(10_000));
  await cmd("end card: ok", "ok");
  await event("after end: duration", () => h.player.emit({ type: "duration", seconds: 2400 }));

  // Settings during playback
  await cmd("playback: quick settings", "quickSettings");
  for (let i = 0; i < 20 && screen().quick?.focusedId !== "settings"; i++)
    await cmd("quick settings: down", "down");
  await cmd("quick settings: All settings", "ok");
  expectView("settings");
  await back("Settings after quick settings: Back");
  expectView("home");
  await open("library", "Library tile fourth");
  await open("shows:show:arcane", "show Arcane fourth");
  await open("play", "Play fourth");
  expectView("player");
  await event("fourth playback: duration", () =>
    h.player.emit({ type: "duration", seconds: 2400 }),
  );
  await cmd("fourth playback: quick settings", "quickSettings");
  await cmd("fourth playback: quick settings Back", "back");
  await back("fourth playback: Back shows controls");
  await back("fourth playback: Back stops");
  await cmd("Home after playback", "home");
  expectView("home");

  // App error: Try again
  await open("youtube", "YouTube tile third");
  await event("YouTube: failed again", () => h.youtube.emit({ type: "failed" }));
  expectView("appError");
  await cmd("App error: Try again", "ok");
  await event("YouTube: failed after retry", () => h.youtube.emit({ type: "failed" }));
  await back("App error again: Back");
  expectView("home");
}
