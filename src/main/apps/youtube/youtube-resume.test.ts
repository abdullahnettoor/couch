import { describe, expect, test } from "vite-plus/test";
import { youtubeDescription } from "./youtube-web.ts";

const resume = (url: string, position = 754.9) =>
  youtubeDescription("130.0.0.0").resume?.(url, position);

describe("YouTube resume URL", () => {
  test.each([
    ["a TV watch page", "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ"],
    [
      "a TV watch page with extras",
      "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&list=PL123&t=5",
    ],
    ["a TV watch/video page", "https://www.youtube.com/tv#/watch/video/control?v=dQw4w9WgXcQ"],
    ["a web watch page", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share"],
  ])("%s becomes the TV watch URL with the video and whole seconds", (_n, url) => {
    expect(resume(url)).toBe("https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=754");
  });

  test("a start of 0 or a bad position starts at 0", () => {
    expect(resume("https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ", -3)).toBe(
      "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=0",
    );
    expect(resume("https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ", Number.NaN)).toBe(
      "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ&t=0",
    );
  });

  test.each([
    ["the TV home", "https://www.youtube.com/tv"],
    ["TV search", "https://www.youtube.com/tv#/search?q=cats"],
    ["TV browse", "https://www.youtube.com/tv#/browse?c=FEwhat_to_watch"],
    ["a Short", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["a watch page without a video", "https://www.youtube.com/tv#/watch"],
    ["a malformed id", "https://www.youtube.com/tv#/watch?v=short"],
    ["an id carrying a script", "https://www.youtube.com/tv#/watch?v=a%26b%3Dc%22%3E%3Cx"],
    ["a look-alike host", "https://www.youtube.com.evil.example/tv#/watch?v=dQw4w9WgXcQ"],
    ["http", "http://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ"],
    ["not a URL", "nonsense"],
  ])("refuses %s", (_n, url) => {
    expect(resume(url)).toBeUndefined();
  });
});
