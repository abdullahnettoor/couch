import { describe, expect, test } from "vite-plus/test";
import { netflixDescription } from "./netflix-web.ts";

const resume = (url: string, position = 754) =>
  netflixDescription("130.0.0.0").resume?.(url, position);

describe("Netflix resume URL", () => {
  test.each([
    ["a plain watch page", "https://www.netflix.com/watch/80100172"],
    [
      "a watch page with Netflix's tracking",
      "https://www.netflix.com/watch/80100172?trackId=14170286&tctx=1%2C0%2C%2C%2C%2C%2C%2C%2C%2CVideo%3A80100172",
    ],
    ["a country prefix", "https://www.netflix.com/in/watch/80100172"],
    ["a country-language prefix", "https://www.netflix.com/in-hi/watch/80100172/"],
    ["the bare host", "https://netflix.com/watch/80100172"],
  ])("%s becomes /watch/<id> and nothing else", (_name, url) => {
    expect(resume(url)).toBe("https://www.netflix.com/watch/80100172");
  });

  test.each([
    ["browse", "https://www.netflix.com/browse"],
    ["a title modal on browse", "https://www.netflix.com/browse?jbv=80100172"],
    ["a title page", "https://www.netflix.com/title/80100172"],
    ["search", "https://www.netflix.com/search?q=arcane"],
    ["the profile picker", "https://www.netflix.com/ProfilesGate"],
    ["a watch page without an id", "https://www.netflix.com/watch/"],
    ["a non-numeric id", "https://www.netflix.com/watch/abc"],
    ["a look-alike host", "https://www.netflix.com.evil.example/watch/80100172"],
    ["a CDN host", "https://assets.nflxext.com/watch/80100172"],
    ["http", "http://www.netflix.com/watch/80100172"],
    ["not a URL", "nonsense"],
  ])("refuses %s", (_name, url) => {
    expect(resume(url)).toBeUndefined();
  });
});
