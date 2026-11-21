import { describe, expect, test } from "vite-plus/test";
import { pageWithPlayerOutsideDocument } from "../../web/fake-media-page.ts";
import { composeReport, playbackProbe } from "../../web/playback.ts";
import { bitchordDescription } from "./bitchord-web.ts";

const description = bitchordDescription(
  "130.0.0.0",
  { request: () => Promise.reject(new Error("no network")), manifest: () => Promise.reject() },
  {},
);
const playback = description.playback!;

describe("BitChord Now Playing", () => {
  test("seek moves the player that plays outside the document", () => {
    const page = pageWithPlayerOutsideDocument();
    page.start();
    page.run(playback.seek!(95.6));
    expect(page.player.currentTime).toBe(95.6);
  });

  test("play/pause pauses and resumes it", () => {
    const page = pageWithPlayerOutsideDocument();
    page.start();
    page.run(playback.playPause!());
    expect(page.player.paused).toBe(true);
    page.run(playback.playPause!());
    expect(page.player.paused).toBe(false);
  });

  test("with nothing playing, seek and play/pause do nothing and don't throw", () => {
    const page = pageWithPlayerOutsideDocument();
    expect(() => page.run(playback.seek!(10))).not.toThrow();
    expect(() => page.run(playback.playPause!())).not.toThrow();
  });

  test("the report has title, artwork and position, and the seek bar is live", async () => {
    const page = pageWithPlayerOutsideDocument();
    page.start();
    const found = (await page.run(playbackProbe({ speeds: playback.speeds }))) as any;
    const report = composeReport(found, undefined, !!playback.seek, description.artworkHosts);
    expect(report).toMatchObject({
      title: "Song",
      artwork: "https://lh3.googleusercontent.com/a",
      position: 31,
      duration: 200,
      canSeek: true,
    });
    expect(report).not.toHaveProperty("speeds");
    expect(report).not.toHaveProperty("tracks");
  });

  test("artwork is kept from YouTube's image hosts and dropped from anywhere else", () => {
    const found = (artwork: string) => ({ position: 1, duration: 9, paused: false, artwork });
    const kept = (u: string) =>
      composeReport(found(u), undefined, true, description.artworkHosts)?.artwork;
    expect(kept("https://i.ytimg.com/vi/x/hq.jpg")).toBeDefined();
    expect(kept("https://lh3.googleusercontent.com/a")).toBeDefined();
    expect(kept("https://yt3.ggpht.com/a")).toBeDefined();
    expect(kept("https://evil.example/a.jpg")).toBeUndefined();
    expect(kept("http://i.ytimg.com/a.jpg")).toBeUndefined();
    expect(kept("https://ytimg.com.evil.example/a.jpg")).toBeUndefined();
  });

  test("no Speed, subtitles, audio tracks or Prompt", () => {
    expect(playback).not.toHaveProperty("speeds");
    expect(playback).not.toHaveProperty("setSpeed");
    expect(playback).not.toHaveProperty("tracks");
    expect(playback).not.toHaveProperty("setTrack");
    expect(playback).not.toHaveProperty("prompt");
  });

  test("songs never enter Continue watching: BitChord has no resume", () => {
    expect(description).not.toHaveProperty("resume");
  });
});
