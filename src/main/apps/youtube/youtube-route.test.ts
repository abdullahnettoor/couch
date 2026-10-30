import { describe, expect, test } from "vite-plus/test";
import { isYouTubeHome, isYouTubeOrigin } from "./youtube-route.ts";

// Routes recorded from a real signed-in session on 2026-10-21.
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

describe("isYouTubeOrigin", () => {
  test("accepts YouTube's own origin only", () => {
    expect(isYouTubeOrigin("https://www.youtube.com")).toBe(true);
    expect(isYouTubeOrigin("https://www.youtube.com/")).toBe(true);
    for (const origin of [
      "https://www.youtube.com.evil.example",
      "https://www.youtube.com@evil.example",
      "http://www.youtube.com",
      "https://youtube.com",
      "",
    ])
      expect(isYouTubeOrigin(origin)).toBe(false);
  });
});
