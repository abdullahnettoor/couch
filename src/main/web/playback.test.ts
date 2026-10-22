import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { composeReport, playbackProbe, sameReport, type PlaybackReport } from "./playback.ts";

interface FakeVideo {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended?: boolean;
  readyState?: number;
  width: number;
  height: number;
}

function video(over: Partial<FakeVideo> = {}): FakeVideo {
  return {
    currentTime: 12.4,
    duration: 3600,
    paused: false,
    readyState: 4,
    width: 1280,
    height: 720,
    ...over,
  };
}

function probe(
  videos: FakeVideo[],
  mediaSession?: unknown,
  tracks?: string,
  active?: string,
): Promise<PlaybackReport | undefined> {
  const sandbox: any = {
    innerWidth: 1280,
    innerHeight: 720,
    document: {
      querySelectorAll: (sel: string) => (sel === "video" ? videos.map(asElement) : []),
    },
    navigator: { mediaSession },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return vm.runInContext(playbackProbe(tracks, active), sandbox);
}

const asElement = (v: FakeVideo) => ({
  ...v,
  getBoundingClientRect: () => ({ width: v.width, height: v.height }),
});

describe("the shared playback script", () => {
  test("reports the playing video's position, length and paused state", async () => {
    expect(await probe([video()])).toEqual({ position: 12, duration: 3600, paused: false });
  });

  test("reports a paused video too, so the phone can resume it", async () => {
    expect(await probe([video({ paused: true, currentTime: 90 })])).toMatchObject({
      position: 90,
      paused: true,
    });
  });

  test("reports nothing without a video, or one that has not loaded or has no length", async () => {
    expect(await probe([])).toBeUndefined();
    expect(await probe([video({ readyState: 0 })])).toBeUndefined();
    expect(await probe([video({ duration: NaN })])).toBeUndefined();
    expect(await probe([video({ duration: Infinity })])).toBeUndefined();
  });

  test("ignores a small preview and picks the large playing video", async () => {
    const small = video({ width: 200, height: 100, currentTime: 3 });
    const big = video({ currentTime: 700 });
    expect(await probe([small, big])).toMatchObject({ position: 700 });
    expect(await probe([small])).toBeUndefined();
  });

  test("takes the title and the largest artwork from the media session", async () => {
    const report = await probe([video()], {
      metadata: {
        title: "Episode 4",
        artwork: [
          { src: "https://img.example/small.jpg", sizes: "96x96" },
          { src: "https://img.example/big.jpg", sizes: "512x512" },
          { src: "data:image/png;base64,AAAA", sizes: "1024x1024" },
        ],
      },
    });
    expect(report).toMatchObject({ title: "Episode 4", artwork: "https://img.example/big.jpg" });
  });

  test("adds the adapter's track lists, and drops them when the adapter fails", async () => {
    const tracks = `({ subtitles: [{ id: "en", label: "English", on: true }], audio: [] })`;
    expect(await probe([video()], undefined, tracks)).toMatchObject({
      tracks: { subtitles: [{ id: "en", label: "English", on: true }], audio: [] },
    });
    const broken = await probe([video()], undefined, `(function(){ throw new Error("gone") })()`);
    expect(broken).toEqual({ position: 12, duration: 3600, paused: false });
  });
});

describe("the adapter's gate", () => {
  test("a false gate reports nothing even with a big playing video; a true gate changes nothing", async () => {
    expect(await probe([video()], undefined, undefined, "false")).toBeUndefined();
    expect(await probe([video()], undefined, undefined, "true")).toMatchObject({ position: 12 });
  });
});

describe("sameReport", () => {
  const a: PlaybackReport = { position: 5, duration: 100, paused: false, title: "x" };
  test("is true for equal reports and false for any change", () => {
    expect(sameReport(a, { ...a })).toBe(true);
    expect(sameReport(a, { ...a, position: 6 })).toBe(false);
    expect(sameReport(a, { ...a, paused: true })).toBe(false);
    expect(sameReport(a, undefined)).toBe(false);
    expect(sameReport(undefined, undefined)).toBe(true);
  });
});

describe("composeReport", () => {
  const found = { position: 5, duration: 60, paused: false };
  const lists = { subtitles: [{ id: "off", label: "Off", on: true }], audio: [] };

  test("a seeking adapter makes the bar live and adds the pickers", () => {
    expect(composeReport(found, lists, true)).toEqual({ ...found, canSeek: true, tracks: lists });
  });

  test("the adapter saying its seek control is missing leaves the bar read-only", () => {
    const r = composeReport(found, { ...lists, canSeek: false }, true)!;
    expect(r.canSeek).toBeUndefined();
    expect(r.tracks).toEqual(lists);
  });

  test("no adapter seek: read-only; nothing playing: nothing", () => {
    expect(composeReport(found, undefined, false)).toEqual(found);
    expect(composeReport(undefined, lists, true)).toBeUndefined();
  });
});
