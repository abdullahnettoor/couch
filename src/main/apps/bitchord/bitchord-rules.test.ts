import { describe, expect, test } from "vite-plus/test";
import { bitchordRequestHeaders, bitchordResponseHeaders } from "./bitchord-rules.ts";

const request = (url: string, headers: Record<string, string> = { Accept: "*/*" }) =>
  bitchordRequestHeaders({ url, requestHeaders: headers });
const response = (url: string, headers: Record<string, string[]> = { Server: ["s"] }) =>
  bitchordResponseHeaders({ url, responseHeaders: headers });
const CORS = { "Access-Control-Allow-Origin": ["*"], "Access-Control-Expose-Headers": ["*"] };

describe("BitChord's request header rules", () => {
  test("YouTube Music's InnerTube carries music.youtube.com's Origin, Referer and X-Origin", () => {
    expect(
      request("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
        origin: "https://x.test",
      }),
    ).toEqual({
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
      "X-Origin": "https://music.youtube.com",
    });
  });

  test("YouTube's InnerTube carries www.youtube.com's", () => {
    expect(request("https://www.youtube.com/youtubei/v1/player")).toEqual({
      Accept: "*/*",
      Origin: "https://www.youtube.com",
      Referer: "https://www.youtube.com/",
      "X-Origin": "https://www.youtube.com",
    });
  });

  test("googlevideo carries YouTube's Origin and Referer, replacing the page's", () => {
    expect(
      request("https://rr3---sn-x.googlevideo.com/videoplayback?c=WEB", {
        Origin: "https://bitchord.example",
        referer: "https://bitchord.example/",
      }),
    ).toEqual({ Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/" });
  });

  test("googlevideo for the VISIONOS client carries neither Origin nor Referer", () => {
    expect(
      request("https://rr3---sn-x.googlevideo.com/videoplayback?c=VISIONOS&x=1", {
        Accept: "*/*",
        Origin: "https://bitchord.example",
        referer: "https://bitchord.example/",
      }),
    ).toEqual({ Accept: "*/*" });
  });

  test.each([
    "https://www.youtube.com/s/player/abc/player_ias.vflset/en_US/base.js",
    "https://www.youtube.com/sw.js_data",
    "https://www.youtube.com/iframe_api",
    "https://www.youtube.com/watch?v=x",
    "https://music.youtube.com/",
    "https://bitchord-8bw.pages.dev/assets/index.js",
    "https://notgooglevideo.com/videoplayback",
    "https://googlevideo.com.evil.example/videoplayback",
    "https://netflix.com/youtubei/v1/x",
    "not a url",
  ])("%s keeps its request headers", (url) => {
    const headers = { Accept: "*/*", Origin: "https://bitchord-8bw.pages.dev" };
    expect(request(url, headers)).toEqual(headers);
  });
});

describe("BitChord's response header rules", () => {
  test.each([
    "https://music.youtube.com/youtubei/v1/search",
    "https://www.youtube.com/youtubei/v1/player",
    "https://rr3---sn-x.googlevideo.com/videoplayback?c=WEB",
    "https://rr3---sn-x.googlevideo.com/videoplayback?c=VISIONOS",
    "https://www.youtube.com/s/player/abc/base.js",
    "https://www.youtube.com/sw.js_data",
    "https://www.youtube.com/iframe_api",
  ])("%s gets permissive CORS headers, replacing the site's", (url) => {
    expect(
      response(url, { server: ["s"], "access-control-allow-origin": ["https://youtube.com"] }),
    ).toEqual({
      server: ["s"],
      ...CORS,
    });
  });

  test.each([
    "https://www.youtube.com/watch?v=x",
    "https://bitchord-8bw.pages.dev/home",
    "https://www.netflix.com/browse",
  ])("%s keeps its response headers", (url) => {
    const headers = { Server: ["s"] };
    expect(response(url, headers)).toBe(headers);
  });
});
