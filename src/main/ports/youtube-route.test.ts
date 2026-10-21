import { describe, expect, test } from "vite-plus/test";
import { isYouTubeHome } from "./youtube-route.ts";

// Routes recorded from a real signed-in session on 2026-10-21 (see .issues/053-youtube-back-confirmations.md).
describe("isYouTubeHome", () => {
  test("Home is the bare route, with nothing open over it", () => {
    for (const url of [
      "https://www.youtube.com/tv",
      "https://www.youtube.com/tv#",
      "https://www.youtube.com/tv#/",
      "https://www.youtube.com/tv#/?env_forceFullAnimation=1",
    ])
      expect(isYouTubeHome(url, false)).toBe(true);
  });

  test("a playing Short keeps Home's URL, so the page itself decides", () => {
    expect(isYouTubeHome("https://www.youtube.com/tv#/", true)).toBe(false);
  });

  test("watch, search, browse tabs and channels are not home", () => {
    for (const url of [
      "https://www.youtube.com/tv#/watch?v=is2IMIMXShI&list=RDis2IMIMXShI",
      "https://www.youtube.com/tv#/search?",
      "https://www.youtube.com/tv#/search?q=cats",
      "https://www.youtube.com/tv#/browse?c=FEsubscriptions",
      "https://www.youtube.com/tv#/browse?c=UCabc",
      "https://www.youtube.com/tv#/settings",
    ])
      expect(isYouTubeHome(url, false)).toBe(false);
  });
});
