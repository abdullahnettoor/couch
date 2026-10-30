import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { PlaybackReport } from "./apps/app.ts";
import { FileStore } from "./ports/store.ts";
import type { FakeYouTube } from "./ports/fakes.ts";
import { startHarness, type FakePhone, type Harness } from "./testing/harness.ts";

let h: Harness;
let phone: FakePhone;
let dirs: string[] = [];
beforeEach(() => {
  dirs = [];
});
afterEach(async () => {
  await h?.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const tmp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

const NETFLIX_ART = "https://occ-0-1.1.nflximg.net/dnm/api/v6/abc.jpg";
const watch = (id: string) => `https://www.netflix.com/watch/${id}`;

function report(over: Partial<PlaybackReport> = {}): PlaybackReport {
  return {
    position: 45,
    duration: 3000,
    paused: false,
    title: "Arcane · S1 E1",
    artwork: NETFLIX_ART,
    resume: watch("80100172"),
    ...over,
  };
}

const play = (app: FakeYouTube, over?: Partial<PlaybackReport>) =>
  app.emit({ type: "playback", playback: report(over) });
const stop = (app: FakeYouTube) => app.emit({ type: "playback", playback: undefined });

async function start(store?: FileStore) {
  h = await startHarness(store);
  phone = await h.connectPhone();
}
const videos = () => h.screen.last.homeVideos ?? [];
const stored = () => h.store.read<{ items?: Array<Record<string, unknown>> }>("continue-apps", {});

describe("remembering App titles", () => {
  test("a title that has played for 30 seconds is remembered, with its art, a progress bar and the App's badge", async () => {
    await start();
    play(h.netflix, { position: 30 });
    expect(videos()).toHaveLength(1);
    expect(videos()[0]).toMatchObject({
      title: "Arcane · S1 E1",
      thumb: NETFLIX_ART,
      app: { id: "netflix", label: "Netflix" },
      progress: { fraction: 30 / 3000 },
    });
    expect(videos()[0]!.app!.icon).toContain("<svg");
  });

  test("less than 30 seconds is not remembered", async () => {
    await start();
    play(h.netflix, { position: 29 });
    expect(videos()).toEqual([]);
    expect(stored().items ?? []).toEqual([]);
  });

  test("a page the App's hook refused (no resume URL) is not remembered", async () => {
    await start();
    play(h.netflix, { resume: undefined });
    expect(videos()).toEqual([]);
  });

  test("one entry per title, its position updated as it plays", async () => {
    await start();
    play(h.netflix, { position: 40 });
    play(h.netflix, { position: 900 });
    expect(videos()).toHaveLength(1);
    expect(videos()[0]!.progress!.fraction).toBeCloseTo(900 / 3000);
    stop(h.netflix);
    expect(stored().items).toHaveLength(1);
    expect(stored().items![0]).toMatchObject({ position: 900 });
  });

  test("a second title is a second entry, newest first", async () => {
    await start();
    play(h.netflix, { position: 40 });
    h.clock.advance(60_000);
    play(h.netflix, { position: 40, title: "Other", resume: watch("70000001") });
    expect(videos().map((v) => v.title)).toEqual(["Other", "Arcane · S1 E1"]);
  });

  test("art from a host that is not the App's own is not kept", async () => {
    await start();
    play(h.netflix, { artwork: undefined });
    expect(videos()[0]!.thumb).toBeUndefined();
  });

  test("nothing is stored beyond App, title, art, URL and times", async () => {
    await start();
    play(h.netflix, { position: 120, tracks: { subtitles: [], audio: [] }, speed: 1 });
    stop(h.netflix);
    const [item] = stored().items!;
    expect(Object.keys(item!).sort()).toEqual(
      ["app", "art", "at", "duration", "position", "title", "url"].sort(),
    );
    expect(item).toMatchObject({ app: "netflix", url: watch("80100172"), art: NETFLIX_ART });
  });

  test("entries survive a restart", async () => {
    const dir = tmp("couch-cont-store-");
    await start(new FileStore(dir));
    play(h.netflix, { position: 300 });
    stop(h.netflix);
    await h.stop();
    await start(new FileStore(dir));
    expect(videos().map((v) => v.title)).toEqual(["Arcane · S1 E1"]);
  });
});

describe("keeping it tidy", () => {
  test("finishing (95% or more) drops the entry", async () => {
    await start();
    play(h.netflix, { position: 600 });
    expect(videos()).toHaveLength(1);
    play(h.netflix, { position: 2850 });
    expect(videos()).toEqual([]);
    stop(h.netflix);
    expect(stored().items ?? []).toEqual([]);
  });

  test("the App reporting the end drops it too", async () => {
    await start();
    play(h.netflix, { position: 600 });
    play(h.netflix, { position: 700, ended: true });
    expect(videos()).toEqual([]);
  });

  test("a finished title is not remembered again while it sits at its end", async () => {
    await start();
    play(h.netflix, { position: 2900 });
    expect(videos()).toEqual([]);
  });

  test("at most 10 App entries; the oldest go", async () => {
    await start();
    for (let i = 1; i <= 12; i++) {
      play(h.netflix, { position: 100, title: `Show ${i}`, resume: watch(String(70000000 + i)) });
      h.clock.advance(1000);
    }
    stop(h.netflix);
    expect(stored().items).toHaveLength(10);
    expect(h.screen.last.homeVideos!.length).toBeLessThanOrEqual(3);
    expect(videos()[0]!.title).toBe("Show 12");
    expect((stored().items as Array<{ title: string }>).map((i) => i.title)).not.toContain(
      "Show 1",
    );
  });
});

describe("showing them", () => {
  test("a hidden App's entries are not shown", async () => {
    const dir = tmp("couch-cont-store-");
    const store = new FileStore(dir);
    store.write("home.apps", { order: ["youtube", "netflix", "library"], hidden: ["netflix"] });
    await start(store);
    play(h.netflix, { position: 300 });
    play(h.youtube, {
      title: "Cat video",
      artwork: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      resume: "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=300",
    });
    expect(videos().map((v) => v.app?.id)).toEqual(["youtube"]);
    expect(h.screen.last.continueCard?.app?.id).toBe("youtube");
  });

  test("mixed with Library videos by time, newest first", async () => {
    const root = tmp("couch-cont-lib-");
    mkdirSync(join(root, "Films"));
    const film = join(root, "Films", "A.Film.2001.mkv");
    writeFileSync(film, "");
    const dir = tmp("couch-cont-store-");
    const store = new FileStore(dir);
    store.write("library", { folders: [root] });
    const old = Date.UTC(2026, 9, 20, 8, 30, 0);
    store.write("history", {
      items: { [film]: { position: 600, duration: 6000, at: old + 1000 } },
    });
    await start(store);
    expect(videos().map((v) => v.path)).toEqual([film]);
    h.clock.advance(5000);
    play(h.netflix, { position: 300 });
    expect(videos().map((v) => v.app?.id ?? "library")).toEqual(["netflix", "library"]);
    expect(h.screen.last.continueCard?.app?.id).toBe("netflix");
  });

  test("the Library page keeps its own row to Library videos", async () => {
    await start();
    play(h.netflix, { position: 300 });
    expect(h.screen.last.library?.continueWatching ?? []).toEqual([]);
  });

  test("the Remote's Continue card shows the newest entry with its art and the App", async () => {
    await start();
    play(h.netflix, { position: 300 });
    stop(h.netflix);
    await phone.waitFor(() => phone.last?.continueCard !== undefined);
    expect(phone.last!.continueCard).toMatchObject({
      title: "Arcane · S1 E1",
      art: NETFLIX_ART,
      app: { id: "netflix", label: "Netflix" },
    });
  });
});

describe("resuming", () => {
  test("OK on an entry opens the App at its resume URL", async () => {
    await start();
    play(h.netflix, { position: 300 });
    stop(h.netflix);
    const entry = videos()[0]!;
    const tile = h.screen.last.grid.find((i) => i.id === entry.path)!;
    h.app.screenCommand({ command: "focusAt", args: { r: tile.r, c: tile.c } });
    h.app.screenCommand({ command: "ok" });
    expect(h.screen.last.state).toMatchObject({ view: "app", app: "netflix" });
    expect(h.netflix.calls.filter((c) => c.call === "openAt")).toEqual([
      { call: "openAt", args: [watch("80100172")] },
    ]);
    const order = h.netflix.calls.map((c) => c.call);
    expect(order.indexOf("openAt")).toBeLessThan(order.indexOf("show"));
  });

  test("the Remote's Continue card does the same", async () => {
    await start();
    play(h.youtube, {
      title: "Cat video",
      artwork: undefined,
      resume: "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=300",
    });
    stop(h.youtube);
    await phone.press("resume");
    expect(h.screen.last.state).toMatchObject({ view: "app", app: "youtube" });
    expect(h.youtube.calls.filter((c) => c.call === "openAt")).toEqual([
      { call: "openAt", args: ["https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=300"] },
    ]);
  });

  test("From start is offered for YouTube (its URL carries the time) and opens without it; Netflix has none", async () => {
    await start();
    play(h.youtube, {
      title: "Cat video",
      artwork: undefined,
      resume: "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=300",
    });
    stop(h.youtube);
    const yt = videos()[0]!;
    expect(yt.app!.fromStart).toBe(true);
    expect(h.screen.last.grid.some((i) => i.id === "fromstart")).toBe(false);
    h.app.screenCommand({ command: "focusAt", args: { r: 2, c: 3 } });
    expect(h.screen.last.focusedId).toBe(yt.path);
    expect(h.screen.last.grid.find((i) => i.id === "fromstart")?.action).toBe(
      `library:playstart:${yt.path}`,
    );
    h.app.screenCommand({ command: "focusAt", args: { r: 1, c: 1 } });
    h.app.screenCommand({ command: "ok" });
    expect(h.youtube.calls.filter((c) => c.call === "openAt")).toEqual([
      { call: "openAt", args: ["https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ"] },
    ]);
  });

  test("Netflix's entry offers no From start", async () => {
    await start();
    play(h.netflix, { position: 300 });
    stop(h.netflix);
    expect(videos()[0]!.app!.fromStart).toBe(false);
    const tile = h.screen.last.grid.find((i) => i.id === videos()[0]!.path)!;
    h.app.screenCommand({ command: "focusAt", args: { r: tile.r, c: tile.c } });
    expect(h.screen.last.grid.some((i) => i.id === "fromstart")).toBe(false);
    expect(h.screen.last.grid.some((i) => i.id === "resume")).toBe(true);
  });
});

describe("forgetting", () => {
  test("Remove from Continue watching drops an App entry for good", async () => {
    const dir = tmp("couch-cont-store-");
    await start(new FileStore(dir));
    play(h.netflix, { position: 300 });
    stop(h.netflix);
    await phone.press({ command: "forgetContinue" });
    expect(videos()).toEqual([]);
    expect(stored().items ?? []).toEqual([]);
    // It does not come back when the page reports the same title again below 30 s... nor after a restart.
    await h.stop();
    await start(new FileStore(dir));
    expect(videos()).toEqual([]);
  });
});
