import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { netflixDescription } from "../apps/netflix/netflix-web.ts";
import {
  parseRange,
  serveTestPage,
  testPageDescription,
  testPageEnabled,
  testPageHtml,
} from "./webkit-test-page.ts";

describe("the dev-only test page that plays a synthetic video in the WebKit host", () => {
  test("is on only with WebKit, non-persistent stores and the flag", () => {
    const on = {
      COUCH_NETFLIX_ENGINE: "webkit",
      COUCH_WEBKIT_EPHEMERAL: "1",
      COUCH_WEBKIT_TEST_PAGE: "1",
    };
    expect(testPageEnabled(on)).toBe(true);
    expect(testPageEnabled({ ...on, COUCH_WEBKIT_TEST_PAGE: undefined })).toBe(false);
    expect(testPageEnabled({ ...on, COUCH_WEBKIT_TEST_PAGE: "true" })).toBe(false);
    expect(testPageEnabled({ ...on, COUCH_WEBKIT_EPHEMERAL: undefined })).toBe(false);
    expect(testPageEnabled({ ...on, COUCH_NETFLIX_ENGINE: "chromium" })).toBe(false);
    expect(testPageEnabled({})).toBe(false);
  });

  test("the page has one large muted, looping, autoplaying video of the served clip", () => {
    const html = testPageHtml();
    expect(html).toMatch(/<video[^>]*\bautoplay\b/);
    expect(html).toMatch(/<video[^>]*\bmuted\b/);
    expect(html).toMatch(/<video[^>]*\bloop\b/);
    expect(html).toContain('src="/clip.mp4"');
    expect(html).not.toMatch(/https?:\/\//);
  });

  describe("byte ranges", () => {
    test.each([
      ["bytes=0-99", 1000, { start: 0, end: 99 }],
      ["bytes=900-", 1000, { start: 900, end: 999 }],
      ["bytes=-100", 1000, { start: 900, end: 999 }],
      ["bytes=0-5000", 1000, { start: 0, end: 999 }],
    ])("%s of %i", (header, size, want) => {
      expect(parseRange(header, size)).toEqual(want);
    });

    test.each(["bytes=2000-", "bytes=5-2", "items=0-1", "bytes=a-b", "bytes=0-1,5-9", ""])(
      "%s is not satisfiable",
      (header) => {
        expect(parseRange(header, 1000)).toBeUndefined();
      },
    );
  });

  describe("the local server", () => {
    let close: (() => Promise<void>) | undefined;
    afterEach(async () => {
      await close?.();
      close = undefined;
    });
    const clip = () => {
      const file = join(mkdtempSync(join(tmpdir(), "couch-test-page-")), "clip.mp4");
      writeFileSync(file, Buffer.from("0123456789".repeat(100)));
      return file;
    };

    test("serves the watch page and the clip, with ranges, on the loopback only", async () => {
      const server = await serveTestPage(clip());
      close = server.close;
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/watch\/1$/);
      expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(await page.text()).toContain("<video");
      const all = await fetch(`${server.origin}/clip.mp4`);
      expect(all.status).toBe(200);
      expect(all.headers.get("accept-ranges")).toBe("bytes");
      expect(all.headers.get("content-length")).toBe("1000");
      const part = await fetch(`${server.origin}/clip.mp4`, { headers: { range: "bytes=10-19" } });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
      expect(await part.text()).toBe("0123456789");
      const bad = await fetch(`${server.origin}/clip.mp4`, { headers: { range: "bytes=5000-" } });
      expect(bad.status).toBe(416);
      expect((await fetch(`${server.origin}/other`)).status).toBe(404);
    });
  });

  describe("its description", () => {
    const base = netflixDescription("130.0.0.0");
    const desc = testPageDescription(base, "http://127.0.0.1:5555");

    test("is Netflix's own, pointed at the watch page, and trusts only that origin", () => {
      expect(desc.id).toBe("netflix");
      expect(desc.url).toBe("http://127.0.0.1:5555/watch/1");
      expect(desc.playback).toBe(base.playback);
      expect(desc.isOwnOrigin("http://127.0.0.1:5555")).toBe(true);
      expect(desc.isOwnOrigin("http://127.0.0.1:5556")).toBe(false);
      expect(desc.isOwnOrigin("https://www.netflix.com")).toBe(false);
      expect(desc.isOwnOrigin("http://localhost:5555")).toBe(false);
    });

    test("its address is a Netflix watch page, so Netflix's playback probe reports it", () => {
      expect(new URL(desc.url).pathname).toMatch(/^\/watch\//);
    });
  });
});
