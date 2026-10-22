import { expect, test } from "vite-plus/test";
import { ownArtwork } from "../../web/playback.ts";
import { youtubeDescription } from "./youtube-web.ts";

test("only YouTube's own image hosts supply Now Playing artwork", () => {
  const hosts = youtubeDescription("130.0.0.0").artworkHosts ?? [];
  expect(ownArtwork("https://i.ytimg.com/vi/abc/maxresdefault.jpg", hosts)).toBe(true);
  expect(ownArtwork("https://tracker.example/a.png", hosts)).toBe(false);
});

test("YouTube's play/pause stays the media key and its artwork stays the media session's", () => {
  const playback = youtubeDescription("130.0.0.0").playback;
  expect(playback?.playPause).toBeUndefined();
  expect(playback?.artwork).toBeUndefined();
});
