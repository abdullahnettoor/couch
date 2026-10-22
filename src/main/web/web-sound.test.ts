import { expect, test } from "vite-plus/test";
import { isYouTubeOrigin } from "../apps/youtube/youtube-route.ts";
import { allowsPermission, pickOutputId } from "./web-sound.ts";

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
