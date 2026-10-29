import { describe, expect, test } from "vite-plus/test";
import { isYouTubeOrigin } from "../apps/youtube/youtube-route.ts";
import { FakeMedia, fakeMediaPage } from "./fake-media-page.ts";
import { hiddenScript } from "./hidden-audio.ts";
import { allowsPermission, pickOutputId, soundScript } from "./web-sound.ts";

// What Chromium reported for this Mac's outputs (labels as the view sees them).
const OUTPUTS = [
  { deviceId: "default", label: "Default - Abdu's Rockerz 333ANC (Bluetooth)" },
  { deviceId: "bt", label: "Abdu's Rockerz 333ANC (Bluetooth)" },
  { deviceId: "mbp", label: "MacBook Pro Speakers (Built-in)" },
  { deviceId: "teams", label: "Microsoft Teams Audio Device (Virtual)" },
  { deviceId: "multi", label: "Multi-Output Device (Aggregate)" },
];

test("matches a CoreAudio name to the page's output by label", () => {
  expect(pickOutputId("MacBook Pro Speakers", OUTPUTS)).toEqual({ id: "mbp" });
  expect(pickOutputId("Abdu's Rockerz 333ANC", OUTPUTS)).toEqual({ id: "bt" });
  expect(pickOutputId("Multi-Output Device", OUTPUTS)).toEqual({ id: "multi" });
  expect(pickOutputId("Microsoft Teams Audio", OUTPUTS)).toEqual({ id: "teams" });
});

test("an output the page doesn't list has no match (the L27h-4A isn't listed by Chromium)", () => {
  expect(pickOutputId("L27h-4A", OUTPUTS)).toEqual({ error: "none" });
});

test("the default entry is never a match", () => {
  expect(pickOutputId("Default", OUTPUTS)).toEqual({ error: "none" });
});

test("two outputs with the same name are ambiguous, never guessed", () => {
  const twins = [
    { deviceId: "a", label: "USB Audio (USB)" },
    { deviceId: "b", label: "USB Audio (Bluetooth)" },
  ];
  expect(pickOutputId("USB Audio", twins)).toEqual({ error: "ambiguous" });
});

test("a whole name beats a longer name that merely starts with it", () => {
  const outputs = [
    { deviceId: "a", label: "Studio Display (DisplayPort)" },
    { deviceId: "b", label: "Studio Display Speakers (Built-in)" },
  ];
  expect(pickOutputId("Studio Display", outputs)).toEqual({ id: "a" });
});

const own = isYouTubeOrigin;

test("the view may pick its output (speaker-selection) for its own origin, whenever setSinkId asks", () => {
  expect(allowsPermission("speaker-selection", "https://www.youtube.com/", false, own)).toBe(true);
  expect(allowsPermission("speaker-selection", "https://evil.example/", false, own)).toBe(false);
});

test("output names (media check) are readable only while Couch lists them, for the own origin", () => {
  expect(allowsPermission("media", "https://www.youtube.com/", true, own)).toBe(true);
  expect(allowsPermission("media", "https://www.youtube.com/", false, own)).toBe(false);
  expect(allowsPermission("media", "https://evil.example/", true, own)).toBe(false);
});

test("nothing else is granted", () => {
  for (const p of ["geolocation", "notifications", "background-sync"])
    expect(allowsPermission(p, "https://www.youtube.com/", true, own)).toBe(false);
});

describe("soundScript in a page", () => {
  test("sets Couch's volume on the media that is there and on media added later", () => {
    const page = fakeMediaPage();
    const first = page.add();
    page.run(soundScript(40, ""));
    expect(first.volume).toBeCloseTo(0.4);
    const later = page.add(new FakeMedia("AUDIO"));
    page.fire("loadstart", later);
    expect(later.volume).toBeCloseTo(0.4);
  });

  test("a mute is volume 0 and unmuting brings the volume back", () => {
    const page = fakeMediaPage();
    const media = page.add();
    page.run(soundScript(60, ""));
    page.run(soundScript(0, ""));
    expect(media.volume).toBe(0);
    page.run(soundScript(60, ""));
    expect(media.volume).toBeCloseTo(0.6);
  });

  test("clamps the level to 0-100", () => {
    const page = fakeMediaPage();
    const media = page.add();
    page.run(soundScript(250, ""));
    expect(media.volume).toBe(1);
    page.run(soundScript(-5, ""));
    expect(media.volume).toBe(0);
  });

  test.each(["play", "loadedmetadata", "volumechange"])(
    "puts Couch's volume back after the page changes it on %s",
    (type) => {
      const page = fakeMediaPage();
      const media = page.add();
      page.run(soundScript(30, ""));
      media.volume = 1;
      page.fire(type, media);
      expect(media.volume).toBeCloseTo(0.3);
    },
  );

  test("running it again does not stack listeners and a later level wins", () => {
    const page = fakeMediaPage();
    const media = page.add();
    page.run(soundScript(30, ""));
    page.run(soundScript(80, ""));
    media.volume = 1;
    page.fire("play", media);
    expect(media.volume).toBeCloseTo(0.8);
  });
});

describe("hiddenScript in a page", () => {
  test("hidden, it pauses the media that is playing and any that starts later", () => {
    const page = fakeMediaPage();
    const playing = page.add();
    page.run(hiddenScript(true));
    expect(playing.paused).toBe(true);
    const later = page.add();
    page.fire("play", later);
    expect(later.paused).toBe(true);
  });

  test("shown, a play is left alone, and an earlier guard is gone", () => {
    const page = fakeMediaPage();
    page.run(hiddenScript(true));
    page.run(hiddenScript(false));
    const media = page.add();
    page.fire("play", media);
    expect(media.paused).toBe(false);
  });

  test("the guard and the sound script together keep a hidden page silent and paused", () => {
    const page = fakeMediaPage();
    const media = page.add();
    page.run(soundScript(0, ""));
    page.run(hiddenScript(true));
    media.volume = 1;
    page.fire("play", media);
    expect(media.volume).toBe(0);
    expect(media.paused).toBe(true);
  });
});
