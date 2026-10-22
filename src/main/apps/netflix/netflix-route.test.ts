import { describe, expect, test } from "vite-plus/test";
import {
  isNetflixHome,
  isNetflixOrigin,
  isNetflixSearchUrl,
  netflixSearchUrlFor,
} from "./netflix-route.ts";

const home = (u: string) => isNetflixHome(new URL(u));

describe("Netflix home", () => {
  test.each([
    ["browse", "https://www.netflix.com/browse"],
    ["browse with a trailing slash", "https://www.netflix.com/browse/"],
    ["browse with other params", "https://www.netflix.com/browse?ref=x"],
    ["profile picker", "https://www.netflix.com/ProfilesGate?nextpage=%2Fbrowse"],
    [
      "login, where a signed-out browse lands",
      "https://www.netflix.com/in/login?nextpage=%2Fbrowse",
    ],
    ["signed-out landing", "https://www.netflix.com/"],
    ["signed-out landing in a country", "https://www.netflix.com/in/"],
    ["signed-out landing in a country and language", "https://www.netflix.com/in-hi"],
  ])("%s is home", (_n, url) => expect(home(url)).toBe(true));

  test.each([
    ["title modal", "https://www.netflix.com/browse?jbv=80100172"],
    ["title modal in a genre", "https://www.netflix.com/browse/genre/34399?jbv=80100172"],
    ["player", "https://www.netflix.com/watch/80100172?trackId=1"],
    ["search", "https://www.netflix.com/search?q=dark"],
    ["account page", "https://www.netflix.com/youraccount"],
    ["title page", "https://www.netflix.com/title/80100172"],
    ["my list", "https://www.netflix.com/browse/my-list"],
    ["new and popular", "https://www.netflix.com/latest"],
  ])("%s is not home", (_n, url) => expect(home(url)).toBe(false));
});

describe("Netflix search", () => {
  test("search pages are recognised and built from the typed text", () => {
    expect(isNetflixSearchUrl("https://www.netflix.com/search?q=dark")).toBe(true);
    expect(isNetflixSearchUrl("https://www.netflix.com/browse")).toBe(false);
    expect(netflixSearchUrlFor(" the crown ")).toBe("https://www.netflix.com/search?q=the%20crown");
    expect(netflixSearchUrlFor("  ")).toBe("https://www.netflix.com/search");
  });
});

describe("Netflix origin", () => {
  test.each([
    "https://www.netflix.com",
    "https://netflix.com",
    "https://assets.nflxext.com",
    "https://occ-0-1.1.nflxso.net",
    "https://ipv4-c001.nflxvideo.net",
    "https://occ.nflximg.net",
  ])("%s is Netflix's", (o) => expect(isNetflixOrigin(o)).toBe(true));

  test.each([
    "https://www.netflix.com.evil.example",
    "http://www.netflix.com",
    "https://evilnetflix.com",
    "https://netflix.com@evil.example",
    "not a url",
  ])("%s is not", (o) => expect(isNetflixOrigin(o)).toBe(false));
});
