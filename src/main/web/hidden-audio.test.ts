import vm from "node:vm";
import { expect, test } from "vite-plus/test";
import { HiddenAudio, hiddenScript } from "./hidden-audio.ts";

class FakeContents {
  muted = false;
  scripts: string[] = [];
  setAudioMuted(muted: boolean) {
    this.muted = muted;
  }
  executeJavaScript(script: string) {
    this.scripts.push(script);
    return Promise.resolve();
  }
}

/** A page with one video and capturing document listeners, as far as the script uses them. */
function fakePage() {
  const listeners: Record<string, Array<(e: { target: unknown }) => void>> = {};
  const video = {
    paused: false,
    pause() {
      this.paused = true;
    },
  };
  const document = {
    querySelectorAll: () => [video],
    addEventListener: (t: string, f: (e: { target: unknown }) => void) =>
      (listeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: unknown) => {
      listeners[t] = (listeners[t] ?? []).filter((x) => x !== f);
    },
  };
  const ctx = vm.createContext({ document, window: {} });
  return {
    video,
    run: (src: string) => vm.runInContext(src, ctx),
    play: () => (listeners.play ?? []).forEach((f) => f({ target: video })),
  };
}

test("hiding mutes the App and showing unmutes it", () => {
  const wc = new FakeContents();
  const audio = new HiddenAudio(wc);
  audio.hide();
  expect(wc.muted).toBe(true);
  audio.show();
  expect(wc.muted).toBe(false);
});

test("media that starts while hidden is paused; it plays again once shown", () => {
  const page = fakePage();
  page.run(hiddenScript(true));
  expect(page.video.paused).toBe(true);
  page.video.paused = false;
  page.play();
  expect(page.video.paused).toBe(true);
  page.run(hiddenScript(false));
  page.video.paused = false;
  page.play();
  expect(page.video.paused).toBe(false);
});

test("hiding twice installs one guard, and the page is told on each change", () => {
  const page = fakePage();
  page.run(hiddenScript(true));
  page.run(hiddenScript(true));
  page.run(hiddenScript(false));
  page.video.paused = false;
  page.play();
  expect(page.video.paused).toBe(false);
});

test("hide and show send the page their script", () => {
  const wc = new FakeContents();
  const audio = new HiddenAudio(wc);
  audio.hide();
  audio.show();
  expect(wc.scripts).toEqual([hiddenScript(true), hiddenScript(false)]);
});
