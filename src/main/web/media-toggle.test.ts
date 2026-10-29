import { describe, expect, test } from "vite-plus/test";
import { fakeMediaPage, FakeMedia } from "./fake-media-page.ts";
import { MEDIA_TOGGLE_SCRIPT } from "./media-toggle.ts";

describe("play/pause for a page with no playback adapter", () => {
  test("pauses a playing video and plays it again", () => {
    const page = fakeMediaPage();
    const video = page.add();
    video.paused = false;
    expect(page.run(MEDIA_TOGGLE_SCRIPT)).toBe(true);
    expect(video.paused).toBe(true);
    expect(page.run(MEDIA_TOGGLE_SCRIPT)).toBe(true);
    expect(video.paused).toBe(false);
  });

  test("takes the element that is playing, not the first one", () => {
    const page = fakeMediaPage();
    const still = page.add();
    still.paused = true;
    const playing = page.add(new FakeMedia("AUDIO"));
    page.run(MEDIA_TOGGLE_SCRIPT);
    expect(playing.paused).toBe(true);
    expect(still.paused).toBe(true);
  });

  test("with none playing it plays the first", () => {
    const page = fakeMediaPage();
    const a = page.add();
    const b = page.add();
    a.paused = true;
    b.paused = true;
    page.run(MEDIA_TOGGLE_SCRIPT);
    expect(a.paused).toBe(false);
    expect(b.paused).toBe(true);
  });

  test("a page with no media does nothing and says so", () => {
    expect(fakeMediaPage().run(MEDIA_TOGGLE_SCRIPT)).toBe(false);
  });

  test("a refused play() never throws into the page", async () => {
    const page = fakeMediaPage();
    const video = page.add();
    video.paused = true;
    video.play = () => Promise.reject(new Error("NotAllowedError"));
    expect(page.run(MEDIA_TOGGLE_SCRIPT)).toBe(true);
    await Promise.resolve();
  });

  test("is one expression", () => {
    expect(MEDIA_TOGGLE_SCRIPT.trim().startsWith("(function")).toBe(true);
  });
});
