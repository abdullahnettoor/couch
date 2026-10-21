import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";
import { pickOutputId, soundScript } from "./youtube-sound.ts";

// What Chromium reported for this Mac's outputs (labels as the view sees them).
const OUTPUTS = [
  { deviceId: "default", label: "Default - Abdu's Rockerz 333ANC (Bluetooth)" },
  { deviceId: "bt", label: "Abdu's Rockerz 333ANC (Bluetooth)" },
  { deviceId: "mbp", label: "MacBook Pro Speakers (Built-in)" },
  { deviceId: "teams", label: "Microsoft Teams Audio Device (Virtual)" },
  { deviceId: "multi", label: "Multi-Output Device (Aggregate)" },
];

test("matches a CoreAudio name to the page's output by label", () => {
  expect(pickOutputId("MacBook Pro Speakers", OUTPUTS)).toBe("mbp");
  expect(pickOutputId("Abdu's Rockerz 333ANC", OUTPUTS)).toBe("bt");
  expect(pickOutputId("Multi-Output Device", OUTPUTS)).toBe("multi");
  expect(pickOutputId("Microsoft Teams Audio", OUTPUTS)).toBe("teams");
});

test("an output the page doesn't list has no match (the L27h-4A isn't listed by Chromium)", () => {
  expect(pickOutputId("L27h-4A", OUTPUTS)).toBeUndefined();
});

test("the default entry is never a match", () => {
  expect(pickOutputId("Default", OUTPUTS)).toBeUndefined();
});

function page() {
  const listeners = new Map<string, (e: { target: unknown }) => void>();
  const media = () => ({
    tagName: "VIDEO",
    volume: 1,
    sinkId: "",
    setSinkId(id: string) {
      this.sinkId = id;
      return Promise.resolve();
    },
  });
  const elements = [media()];
  const document = {
    addEventListener: (type: string, fn: (e: { target: unknown }) => void) =>
      listeners.set(type, fn),
    querySelectorAll: () => elements,
  };
  const window = {};
  return { document, window, listeners, elements, media };
}

test("sets volume and output on media now, and again when YouTube loads or changes it", () => {
  const p = page();
  runInNewContext(soundScript(40, "mbp"), { document: p.document, window: p.window });
  expect(p.elements[0]).toMatchObject({ volume: 0.4, sinkId: "mbp" });
  const fresh = p.media();
  p.listeners.get("loadstart")!({ target: fresh });
  expect(fresh).toMatchObject({ volume: 0.4, sinkId: "mbp" });
  fresh.volume = 1;
  p.listeners.get("volumechange")!({ target: fresh });
  expect(fresh.volume).toBe(0.4);
});

test("a later call changes the numbers without adding listeners; empty id is System default", () => {
  const p = page();
  const run = (v: number, id: string) =>
    runInNewContext(soundScript(v, id), { document: p.document, window: p.window });
  run(40, "mbp");
  const before = p.listeners.get("play");
  run(70, "");
  expect(p.listeners.get("play")).toBe(before);
  expect(p.elements[0]).toMatchObject({ volume: 0.7, sinkId: "" });
});
