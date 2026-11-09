// Records the fixtures the screenshot harness (look-snap.mts) draws, by driving the core harness through each Page and overlay.
// Run: env -u ELECTRON_RUN_AS_NODE node scripts/look-record.mts
// The fixtures are committed; run this again only when the payloads change shape.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CommandName, RemoteSnapshot, ScreenPayload } from "../src/shared/protocol.ts";
import { FileStore } from "../src/main/ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "../src/main/testing/harness.ts";
import { FIXTURE_DIR, fixturePictureUrl } from "./look-fixture-data.ts";

const root = join(mkdtempSync(join(tmpdir(), "look-record-lib-")), "Media");
const storeDir = mkdtempSync(join(tmpdir(), "look-record-store-"));
const touch = (...parts: string[]) => {
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...parts), "");
};
const FILMS = [
  "Films/Paddington.2.2017.1080p.mkv",
  "Films/The.Grand.Budapest.Hotel.2014.1080p.mkv",
  "Films/Elemental.2023.1080p.mkv",
  "Films/Blade.Runner.2049.2017.mkv",
  "Films/Heat.1995.mkv",
];
const EPISODES = [
  "Arcane/Season 1/Arcane S01E01 Welcome to the Playground.mkv",
  "Arcane/Season 1/Arcane S01E02 Some Mysteries.mkv",
  "Arcane/Season 1/Arcane S01E03 The Base Violence.mkv",
  "Arcane/Season 2/Arcane S02E01 Heavy Is the Crown.mkv",
  "Arcane/Season 2/Arcane S02E02 Watch It All Burn.mkv",
];
for (const f of [...FILMS, ...EPISODES, "Home Videos/Beach.mp4"]) touch(...f.split("/"));
const path = (rel: string) => join(root, ...rel.split("/"));

const store = new FileStore(storeDir);
store.write("library", { folders: [root] });
const NOW = Date.UTC(2026, 9, 20, 8, 30, 0);
const progress = (rel: string, position: number, duration: number, ago: number) => [
  path(rel),
  { position, duration, at: NOW - ago * 60_000 },
];
store.write("history", {
  items: Object.fromEntries([
    progress(FILMS[0], 2400, 6000, 5),
    progress(FILMS[1], 1200, 5900, 60),
    progress(EPISODES[1], 900, 2700, 120),
    [path(EPISODES[0]), { duration: 2700, watched: true, at: NOW - 3_000_000 }],
  ]),
});

const h: Harness = await startHarness(store, { tmdbProjectKey: "eyJ.fixture.key" });
h.metadata.catalog.show.arcane = [
  { id: 94605, name: "Arcane", year: 2021, posterPath: "/arcane.jpg", overview: "Two sisters." },
  { id: 11, name: "Arcane: League", year: 2019, posterPath: "/x.jpg" },
];
h.metadata.catalog.film["paddington 2"] = [
  { id: 346648, name: "Paddington 2", year: 2017, posterPath: "/p2.jpg" },
];
await h.app.core.library.settled();
await h.app.core.details.settled();
const phone: FakePhone = await h.connectPhone();

const screen = () => h.app.screen();
const press = (c: CommandName) => phone.press(c);
async function focusOn(id: string) {
  for (let i = 0; i < 80 && screen().focusedId !== id; i++) {
    const { grid, focusedId } = screen();
    const cur = grid.find((x) => x.id === focusedId);
    const t = grid.find((x) => x.id === id);
    if (!cur || !t) throw new Error(`cannot reach ${id} from ${focusedId}`);
    await press(t.r > cur.r ? "down" : t.r < cur.r ? "up" : t.c > cur.c ? "right" : "left");
  }
  if (screen().focusedId !== id) throw new Error(`could not focus ${id}`);
}
const open = async (id: string) => {
  await focusOn(id);
  await press("ok");
};
const toHome = async () => {
  await press("home");
  await h.settle();
};
async function settled() {
  await h.settle();
  await h.app.core.details.settled();
  await h.settle();
}

/** Picture URLs name the harness's own server: make them stand-ins that don't depend on the port or the run. */
const stable = (value: unknown): unknown => {
  if (typeof value === "string") {
    if (value.startsWith("http://127.0.0.1") || value.startsWith("file:///tmdb/"))
      return fixturePictureUrl(value);
    if (value.startsWith("http://") && value.includes("key="))
      return "http://192.168.0.2:4747/?key=fixture";
    return value.replaceAll(root, "/Volumes/Media").replaceAll(storeDir, "/store");
  }
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => [
        typeof k === "string" ? (stable(k) as string) : k,
        stable(v),
      ]),
    );
  return value;
};

const written: string[] = [];
const save = (kind: "screen" | "phone", name: string, data: ScreenPayload | RemoteSnapshot) => {
  const dir = join(FIXTURE_DIR, kind);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(stable(data), null, 1) + "\n");
  written.push(`${kind}/${name}`);
};
const snap = async (name: string, phoneToo = false) => {
  await settled();
  save("screen", name, screen());
  if (phoneToo && phone.last) save("phone", name, phone.last);
};

// Home (past the toast that welcomes the phone)
h.clock.advance(10_000);
await toHome();
await snap("home", true);

// A hero: Home with a Continue watching film in focus
await toHome();
await focusOn(path(FILMS[0]));
await snap("home-hero");

// Ambient Home: wait for the idle clock
await toHome();
h.clock.advance(10 * 60_000);
await settled();
await snap("home-ambient");
h.app.screenCommand({ command: "focusAt", args: { r: 0, c: 0 } });

// Library
await toHome();
await open("library");
await settled();
await snap("library");
{
  await open(root);
  await settled();
  await snap("folder-root");
  await open(join(root, "Films"));
  await settled();
  await snap("folder");
  await press("back");
  await press("back");
}

// Library search
await toHome();
await open("library");
await settled();
await press("typeOpen");
await phone.press({ command: "typeText", args: { text: "ar" } });
await settled();
await snap("library-search");
await press("typeCancel");

// Show page, then its Fix match
await toHome();
await open("library");
await settled();
await open("shows:show:arcane");
await settled();
await snap("show");
await open("fix");
await phone.waitFor(() => screen().state.view === "fixMatch" && !screen().fixMatch?.loading);
await snap("fix-match");

// Settings and each page
await toHome();
await press("openSettings");
await settled();
await snap("settings");
const settingsPages: Array<[string, string]> = [
  ["remotes", "settings-remotes"],
  ["library", "settings-library"],
  ["sound", "settings-sound"],
  ["apps", "settings-apps"],
  ["home", "settings-home"],
  ["about", "settings-about"],
];
for (const [row, name] of settingsPages) {
  await open(row);
  await settled();
  await snap(name);
  await press("back");
}
await open("about");
await open("support");
await settled();
await snap("settings-about-support");
await press("back");
await press("back");
await open("remotes");
await open("add-phone");
await settled();
await snap("settings-add-phone");
await toHome();
await press("openSettings");
await open("library");
await open("library-folders");
await settled();
await snap("settings-library-folders");
await press("back");
await open("details");
await settled();
await snap("settings-details");

// Quick settings
await toHome();
await press("quickSettings");
await settled();
await snap("overlay-quick-settings");
await press("quickSettings");
await settled();

// Volume and toast over Home
await press("volUp");
await settled();
await snap("overlay-volume");
h.app.toast("Removed from Continue watching");
await settled();
await snap("overlay-toast");
h.clock.advance(10_000);
await toHome();

// App error page and a confirm question (Back at YouTube's home)
await toHome();
await open("youtube");
await settled();
h.youtube.emit({ type: "route", home: true });
await press("back");
await settled();
await snap("overlay-confirm", true);
await press("home");
await h.settle();
await open("youtube");
h.youtube.emit({ type: "failed" });
await phone.waitFor(() => phone.last?.view === "appError");
await snap("app-error");
await press("home");
await h.settle();

// Library playback with the controls
await toHome();
await open("library");
await settled();
await open(root);
await open(join(root, "Films"));
await open(path(FILMS[0]));
await h.settle();
h.player.emit?.({ type: "duration", seconds: 6000 });
await h.settle();
await snap("player", true);

// Picture off: the black cover over playback
await phone.press({ command: "setPictureOff", args: { on: true } });
await settled();
await snap("overlay-picture-off");
await phone.press({ command: "setPictureOff", args: { on: false } });
await settled();

// Up next: the list of the folder's videos, opened from the dock (Right on the progress bar seeks, so focus it directly)
const upNext = screen().grid.find((x) => x.id === "upnext")!;
h.app.screenCommand({ command: "focusAt", args: { r: upNext.r, c: upNext.c } });
await press("ok");
await settled();
await snap("player-up-next");
await press("back");
await settled();

// The end of the video: the card offering the next one in the folder
h.player.emit?.({ type: "ended", reason: "eof" });
await settled();
await snap("player-next");

// Leave the end card, then the Settings pages that only these images draw
await press("home");
await h.settle();
// Credits: Settings → Library → Show and film details → Credits
await toHome();
await press("openSettings");
await open("library");
await open("details");
await settled();
await open("credits");
await settled();
await snap("settings-credits");

// Settings → Apps → YouTube's menu → Add-ons
await toHome();
await press("openSettings");
await open("apps");
await open("youtube");
await settled();
await open("addons");
await settled();
await snap("settings-addons");

await h.stop();
phone.close();

// Setup, on a fresh install: its first step, with a phone paired
const setupHarness = await startHarness(
  new FileStore(mkdtempSync(join(tmpdir(), "look-record-setup-"))),
  {
    setup: "fresh",
  },
);
const setupPhone = await setupHarness.connectPhone();
setupHarness.clock.advance(10_000);
await setupHarness.settle();
if (!setupHarness.screen.last.setup) throw new Error("Setup did not open");
save("screen", "overlay-setup", setupHarness.screen.last);
if (setupPhone.last) save("phone", "setup", setupPhone.last);
written.push("setup");
await setupHarness.stop();

console.log(`recorded ${written.length} fixtures:\n${written.join("\n")}`);
rmSync(join(root, ".."), { recursive: true, force: true });
rmSync(storeDir, { recursive: true, force: true });
void resolve;
