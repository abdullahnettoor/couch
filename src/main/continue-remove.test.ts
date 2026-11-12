import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { PlaybackReport } from "./apps/app.ts";
import { History } from "./core/history.ts";
import { parseCommand } from "./remote/server.ts";
import { MemoryStore } from "./ports/store.ts";
import { FileStore } from "./ports/store.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";
import { REMOTE_PAGE } from "./remote/page.ts";

let h: Harness | undefined;
let phone: FakePhone;
const dirs: string[] = [];
afterEach(async () => {
  await h?.stop();
  h = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const raw = (args?: unknown) =>
  JSON.stringify({ type: "command", command: "forgetContinue", args });
const watch = (id: string) => `https://www.netflix.com/watch/${id}`;

describe("forgetContinue through the Remote parser", () => {
  test.each([
    ["a Library video's path", "/Volumes/Media/Films/Heat (1995)/Heat.mkv"],
    ["an App title's id", `app:netflix:${watch("80100172")}`],
    ["a YouTube title's id", "app:youtube:https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ"],
  ])("takes %s", (_n, entry) => {
    expect(parseCommand(raw({ entry }))?.args).toEqual({ entry });
  });

  test.each([
    ["an App id with no title", "app:netflix"],
    ["an App id with no App", "app::https://www.netflix.com/watch/1"],
    ["an App id with a bad App name", "app:Net flix:https://www.netflix.com/watch/1"],
    ["an App id with a script as the title", "app:netflix:javascript:alert(1)"],
    ["an App id with a data URL", "app:netflix:data:text/html,x"],
    ["a relative path", "Films/Heat.mkv"],
    ["an object key that is not a path", "__proto__"],
    ["another object key", "constructor"],
    ["a path with a NUL", "/Films/Heat.mkv\0"],
    ["an empty id", ""],
  ])("refuses %s", (_n, entry) => {
    expect(parseCommand(raw({ entry }))).toBeUndefined();
  });

  test("no entry at all still means the newest", () => {
    expect(parseCommand(raw())).toEqual({ command: "forgetContinue" });
  });
});

describe("History.forget", () => {
  test("only forgets what it holds itself: object keys are not records", () => {
    const store = new MemoryStore();
    const history = new History(store);
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"])
      expect(history.forget(key)).toBe(false);
    expect(({} as Record<string, unknown>).constructor).toBeDefined();
  });
});

function setup() {
  const media = mkdtempSync(join(tmpdir(), "couch-cont-rm-"));
  dirs.push(media);
  const storeDir = mkdtempSync(join(tmpdir(), "couch-cont-rm-store-"));
  dirs.push(storeDir);
  const store = new FileStore(storeDir);
  const film = join(media, "Sing.2016.mkv");
  const seen = join(media, "Seen.Film.2001.mkv");
  mkdirSync(media, { recursive: true });
  writeFileSync(film, "");
  writeFileSync(seen, "");
  store.write("library", { folders: [media] });
  store.write("history", {
    items: {
      [film]: { position: 600, duration: 6000, at: 1 },
      [seen]: { duration: 6000, watched: true, at: 2 },
    },
  });
  return { store, film, seen };
}

const report = (over: Partial<PlaybackReport> = {}): PlaybackReport => ({
  position: 300,
  duration: 3000,
  paused: false,
  title: "Arcane · S1 E1",
  resume: watch("80100172"),
  ...over,
});
const history = (store: FileStore) =>
  store.read<{ items: Record<string, Record<string, unknown>> }>("history", { items: {} }).items;

async function start(s: ReturnType<typeof setup>, apps = true) {
  h = await startHarness(s.store);
  phone = await h.connectPhone();
  if (apps) {
    h.netflix.emit({ type: "playback", playback: report() });
    h.netflix.emit({ type: "playback", playback: undefined });
  }
  return h;
}
const videos = () => h!.screen.last.homeVideos ?? [];
const appEntry = () => videos().find((v) => v.app)!;
const removedToast = () => h!.screen.last.state.toast === "Removed from Continue watching";

describe("forgetContinue validated against the current entries", () => {
  test("an unknown id is refused: nothing changes, no toast", async () => {
    const s = setup();
    await start(s);
    const before = videos().map((v) => v.path);
    for (const entry of [
      "/no/such/video.mkv",
      "app:netflix:https://www.netflix.com/watch/999",
      "app:nothere:https://x.example/watch/1",
    ])
      await phone.press({ command: "forgetContinue", args: { entry } }).catch(() => {});
    await h!.settle();
    expect(videos().map((v) => v.path)).toEqual(before);
    expect(removedToast()).toBe(false);
  });

  test("a completed Library video is refused, and its watched record is not erased", async () => {
    const s = setup();
    await start(s);
    expect(history(s.store)[s.seen]).toMatchObject({ watched: true });
    await phone.press({ command: "forgetContinue", args: { entry: s.seen } }).catch(() => {});
    await h!.settle();
    expect(history(s.store)[s.seen]).toMatchObject({ watched: true });
    expect(removedToast()).toBe(false);
  });

  test("a video that is merely on disk, with no progress, is not an entry either", async () => {
    const s = setup();
    await start(s);
    h!.app.core.handle({ command: "forgetContinue", args: { entry: "__proto__" } }, "screen");
    h!.app.core.handle({ command: "forgetContinue", args: { entry: "constructor" } }, "screen");
    expect(removedToast()).toBe(false);
  });

  test("a current Library entry and a current App entry are both removed", async () => {
    const s = setup();
    await start(s);
    await phone.press({ command: "forgetContinue", args: { entry: s.film } });
    expect(history(s.store)[s.film]).toBeUndefined();
    expect(videos().map((v) => v.path)).toEqual([appEntry().path]);
    await phone.press({ command: "forgetContinue", args: { entry: appEntry().path } });
    expect(videos()).toEqual([]);
  });

  test("an entry that has already gone is refused the second time", async () => {
    const s = setup();
    await start(s);
    const id = appEntry().path;
    h!.app.core.handle({ command: "forgetContinue", args: { entry: id } }, "screen");
    expect(videos().some((v) => v.app)).toBe(false);
    expect(removedToast()).toBe(true);
    h!.clock.advance(10_000);
    await h!.settle();
    expect(removedToast()).toBe(false);
    h!.app.core.handle({ command: "forgetContinue", args: { entry: id } }, "screen");
    expect(removedToast()).toBe(false);
  });
});

describe("the Screen's menu on a Continue tile", () => {
  const focusTile = (path: string) => {
    const tile = h!.screen.last.grid.find((i) => i.id === path)!;
    h!.app.screenCommand({ command: "focusAt", args: { r: tile.r, c: tile.c } });
    expect(h!.screen.last.focusedId).toBe(path);
  };

  test("Menu on an App title offers Remove from Continue watching, and OK removes it", async () => {
    const s = setup();
    await start(s);
    focusTile(appEntry().path);
    h!.app.screenCommand({ command: "menu" });
    expect(h!.screen.last.state.confirm).toMatchObject({
      title: "Arcane · S1 E1",
      buttons: ["Remove from Continue watching", "Cancel"],
      focus: 0,
    });
    h!.app.screenCommand({ command: "ok" });
    expect(h!.screen.last.state.confirm).toBeUndefined();
    expect(videos().some((v) => v.app)).toBe(false);
    expect(h!.screen.last.state.toast).toBe("Removed from Continue watching");
  });

  test("Cancel and Back leave it alone", async () => {
    const s = setup();
    await start(s);
    focusTile(appEntry().path);
    h!.app.screenCommand({ command: "menu" });
    h!.app.screenCommand({ command: "right" });
    h!.app.screenCommand({ command: "ok" });
    expect(videos().some((v) => v.app)).toBe(true);
    h!.app.screenCommand({ command: "menu" });
    h!.app.screenCommand({ command: "back" });
    expect(h!.screen.last.state.confirm).toBeUndefined();
    expect(videos().some((v) => v.app)).toBe(true);
  });

  test("Menu on a Library video's tile offers it too, and removes only its saved position", async () => {
    const s = setup();
    await start(s, false);
    focusTile(s.film);
    h!.app.screenCommand({ command: "menu" });
    expect(h!.screen.last.state.confirm?.buttons).toEqual([
      "Remove from Continue watching",
      "Cancel",
    ]);
    h!.app.screenCommand({ command: "ok" });
    expect(history(s.store)[s.film]).toBeUndefined();
    expect(history(s.store)[s.seen]).toMatchObject({ watched: true });
  });

  test("Menu on a Library film also offers Fix match when details are on", async () => {
    const s = setup();
    s.store.write("tmdb", { key: "abcd1234ownkey9876" });
    await start(s, false);
    await h!.app.core.details.settled();
    focusTile(s.film);
    h!.app.screenCommand({ command: "menu" });
    expect(h!.screen.last.state.confirm?.buttons).toEqual([
      "Remove from Continue watching",
      "Fix match",
      "Cancel",
    ]);
    h!.app.screenCommand({ command: "right" });
    h!.app.screenCommand({ command: "ok" });
    expect(h!.screen.last.state.view).toBe("fixMatch");
    h!.app.screenCommand({ command: "back" });
    expect(h!.screen.last.state.view).toBe("home");
    expect(h!.screen.last.focusedId).toBe(s.film);
  });

  test("Menu on something that is not a Continue tile does nothing", async () => {
    const s = setup();
    await start(s);
    const app = h!.screen.last.grid.find((i) => i.id === "youtube")!;
    h!.app.screenCommand({ command: "focusAt", args: { r: app.r, c: app.c } });
    h!.app.screenCommand({ command: "menu" });
    expect(h!.screen.last.state.confirm).toBeUndefined();
  });
});

describe("the phone's hint on the Continue card", () => {
  test("the card says Hold to remove", () => {
    const card = /id="cw"[\s\S]*?<\/button>/.exec(REMOTE_PAGE)?.[0] ?? "";
    expect(card).toMatch(/Hold to remove/);
  });
});
