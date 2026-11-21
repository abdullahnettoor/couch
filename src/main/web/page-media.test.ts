import { describe, expect, test } from "vite-plus/test";
import { hiddenScript } from "./hidden-audio.ts";
import { playbackProbe } from "./playback.ts";
import { soundScript } from "./web-sound.ts";
import { pageWithPlayerOutsideDocument } from "./fake-media-page.ts";

describe("page media outside the document", () => {
  test("Couch's volume and output reach an element that starts playing outside the document", async () => {
    const page = pageWithPlayerOutsideDocument();
    await page.run(soundScript(40, "speaker-1"));
    page.start();
    expect(page.player.volume).toBeCloseTo(0.4);
    await Promise.resolve();
    expect(page.player.sinkId).toBe("speaker-1");
    await page.run(soundScript(0, "speaker-1"));
    expect(page.player.volume).toBe(0);
  });

  test("hiding pauses it, now and when it starts again", () => {
    const page = pageWithPlayerOutsideDocument();
    page.start();
    page.run(hiddenScript(true));
    expect(page.player.paused).toBe(true);
    page.start();
    expect(page.player.paused).toBe(true);
    page.run(hiddenScript(false));
    page.start();
    expect(page.player.paused).toBe(false);
  });

  test("the playback report reads an audio element outside the document, with the media session's title", async () => {
    const page = pageWithPlayerOutsideDocument();
    page.start();
    expect(await page.run(playbackProbe())).toEqual({
      position: 31,
      duration: 200,
      paused: false,
      title: "Song",
      artwork: "https://lh3.googleusercontent.com/a",
    });
  });

  test("nothing is reported before anything plays", async () => {
    const page = pageWithPlayerOutsideDocument();
    expect(await page.run(playbackProbe())).toBeUndefined();
  });
});
