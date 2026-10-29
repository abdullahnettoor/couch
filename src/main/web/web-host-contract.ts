import { describe, expect, test, vi } from "vite-plus/test";
import { netflixDescription } from "../apps/netflix/netflix-web.ts";
import type { YouTube, YouTubeEvent } from "../ports/youtube.ts";
import type { PlaybackAdapter } from "./web-app.ts";
import { soundScript } from "./web-sound.ts";

/** What the shared host contract needs of an engine's test rig (fake `WebContents`, or the fake WebKit bridge). */
export interface HostRig {
  host: Required<Omit<YouTube, "followsMacOutput">>;
  events: YouTubeEvent[];
  /** Shows the host and waits until its home has been asked for. */
  show(): Promise<void>;
  /** The page answers any script containing `part` with `value`. */
  answer(part: string, value: unknown): void;
  /** Every script from now on throws in the page. */
  failScripts(): void;
  /** Every script the host ran in the page. */
  scripts(): string[];
  /** The key codes pressed natively, in order (key down only). */
  keys(): string[];
  /** The page moves to `url` without a reload (a pushState). */
  navigate(url: string): void;
  /** Every address the host asked the page to load. */
  loads(): string[];
  /** The page finishes loading its home (the engine's load-completion event). */
  loaded(): void;
  /** Back by history has somewhere to go. */
  allowHistoryBack(): void;
}

export const contractDescription = netflixDescription("130.0.0.0");
const netflix = contractDescription;
const playing = { position: 12, duration: 3000, paused: false, title: "Test Pattern" };

/** The behaviour every web-App host shares, whatever engine draws the page. Run against each adapter. */
export function describeWebHostContract(name: string, makeRig: () => HostRig): void {
  describe(`web host contract: ${name}`, () => {
    describe("playback", () => {
      test("reports what the page's probe finds while shown", async () => {
        vi.useFakeTimers();
        try {
          const rig = makeRig();
          await rig.show();
          rig.answer('querySelectorAll("video")', playing);
          await vi.advanceTimersByTimeAsync(500);
          expect(rig.events).toContainEqual({
            type: "playback",
            playback: expect.objectContaining({
              position: 12,
              paused: false,
              title: "Test Pattern",
            }),
          });
        } finally {
          vi.useRealTimers();
        }
      });

      test("reports nothing playing once hidden, and stops asking", async () => {
        vi.useFakeTimers();
        try {
          const rig = makeRig();
          await rig.show();
          rig.answer('querySelectorAll("video")', playing);
          await vi.advanceTimersByTimeAsync(500);
          rig.host.hide();
          expect(rig.events.at(-1)).toEqual({ type: "playback", playback: undefined });
          const n = rig.scripts().length;
          await vi.advanceTimersByTimeAsync(2000);
          expect(
            rig
              .scripts()
              .slice(n)
              .some((s) => s.includes('querySelectorAll("video")')),
          ).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });

      test("a probe that fails after a report reports nothing playing", async () => {
        vi.useFakeTimers();
        try {
          const rig = makeRig();
          await rig.show();
          rig.answer('querySelectorAll("video")', playing);
          await vi.advanceTimersByTimeAsync(500);
          rig.failScripts();
          await vi.advanceTimersByTimeAsync(500);
          expect(rig.events.at(-1)).toEqual({ type: "playback", playback: undefined });
        } finally {
          vi.useRealTimers();
        }
      });

      test("a skip with the adapter's seek goes to the position it computes", async () => {
        vi.useFakeTimers();
        try {
          const rig = makeRig();
          await rig.show();
          rig.answer('querySelectorAll("video")', playing);
          await vi.advanceTimersByTimeAsync(500);
          rig.host.seekBy(10);
          expect(rig.scripts().at(-1)).toBe(
            (netflix.playback as Required<PlaybackAdapter>).seek(22),
          );
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("adapter commands", () => {
      test("play/pause, seek, speed, track and prompt run the adapter's own scripts", async () => {
        const rig = makeRig();
        await rig.show();
        const adapter = netflix.playback as Required<PlaybackAdapter>;
        rig.host.playPause();
        expect(rig.scripts().at(-1)).toBe(adapter.playPause());
        rig.host.seekTo(90);
        expect(rig.scripts().at(-1)).toBe(adapter.seek(90));
        rig.host.setSpeed(1.5);
        expect(rig.scripts().at(-1)).toBe(adapter.setSpeed(1.5));
        rig.host.setTrack("audio", "a1");
        expect(rig.scripts().at(-1)).toBe(adapter.setTrack("audio", "a1"));
        rig.host.pressPrompt("skipIntro");
        expect(rig.scripts().at(-1)).toBe(adapter.pressPrompt("skipIntro"));
      });

      test("scrolling to the top runs a smooth scroll in the page", async () => {
        const rig = makeRig();
        await rig.show();
        rig.host.scrollToTop();
        expect(rig.scripts().at(-1)).toContain("scrollTo");
      });
    });

    describe("sound", () => {
      const lastSound = (rig: HostRig) =>
        rig
          .scripts()
          .filter((s) => s.includes("__couchSound"))
          .at(-1);

      test("Couch's volume reaches the page's media through the shared sound script", async () => {
        const rig = makeRig();
        await rig.show();
        rig.host.setVolume(40);
        await vi.waitFor(() => expect(lastSound(rig)).toBe(soundScript(40, "", false)));
      });

      test("a mute (volume 0) and the volume back are both applied", async () => {
        const rig = makeRig();
        await rig.show();
        rig.host.setVolume(0);
        await vi.waitFor(() => expect(lastSound(rig)).toBe(soundScript(0, "", false)));
        rig.host.setVolume(55);
        await vi.waitFor(() => expect(lastSound(rig)).toBe(soundScript(55, "", false)));
      });

      test("a page that finishes loading gets the current volume", async () => {
        const rig = makeRig();
        await rig.show();
        rig.host.setVolume(25);
        await vi.waitFor(() => expect(lastSound(rig)).toBe(soundScript(25, "", false)));
        rig.scripts().length = 0;
        rig.loaded();
        await vi.waitFor(() => expect(lastSound(rig)).toBe(soundScript(25, "", false)));
      });
    });

    describe("keys and Back", () => {
      test("OK and the arrows are pressed with the description's key codes", async () => {
        const rig = makeRig();
        await rig.show();
        for (const key of ["ok", "left", "right", "up", "down"] as const) rig.host.sendKey(key);
        expect(rig.keys()).toEqual(["Return", "Left", "Right", "Up", "Down"]);
      });

      test("Back with nothing open goes back in the page's history and presses nothing", async () => {
        const rig = makeRig();
        await rig.show();
        rig.allowHistoryBack();
        rig.host.sendKey("back");
        await vi.waitFor(() => expect(rig.scripts().at(-1)).toBe("history.back()"));
        expect(rig.keys()).toEqual([]);
      });

      test("Back with a pop-up open presses Escape", async () => {
        const rig = makeRig();
        await rig.show();
        rig.answer("__couchPlayerBack", "escape");
        rig.host.sendKey("back");
        await vi.waitFor(() => expect(rig.keys()).toEqual(["Escape"]));
      });

      test("Back the page handled itself presses nothing and says so", async () => {
        const rig = makeRig();
        await rig.show();
        rig.answer("__couchPlayerBack", "handled");
        rig.host.sendKey("back");
        await vi.waitFor(() => expect(rig.events).toContainEqual({ type: "backHandled" }));
        expect(rig.keys()).toEqual([]);
      });
    });

    describe("route", () => {
      test("Netflix's Help Centre is a page to go back from, not home, so Back goes back in history", async () => {
        const rig = makeRig();
        await rig.show();
        rig.navigate("https://www.netflix.com/");
        expect(rig.events.at(-1)).toEqual(expect.objectContaining({ type: "route", home: true }));
        rig.navigate("https://help.netflix.com/en/");
        expect(rig.events.at(-1)).toEqual(expect.objectContaining({ type: "route", home: false }));
        rig.navigate("https://help.netflix.com/en/node/412");
        expect(rig.events.at(-1)).toEqual(expect.objectContaining({ type: "route", home: false }));
        rig.allowHistoryBack();
        rig.host.sendKey("back");
        await vi.waitFor(() => expect(rig.scripts().at(-1)).toBe("history.back()"));
      });

      test("the browse page is home, a title's player is not", async () => {
        const rig = makeRig();
        await rig.show();
        rig.navigate("https://www.netflix.com/browse");
        expect(rig.events).toContainEqual(expect.objectContaining({ type: "route", home: true }));
        rig.navigate("https://www.netflix.com/watch/80018499");
        expect(rig.events.at(-1)).toEqual(expect.objectContaining({ type: "route", home: false }));
      });

      test("arriving at search is reported once, and leaving then arriving again is reported again", async () => {
        vi.useFakeTimers();
        try {
          const rig = makeRig();
          await rig.show();
          const search = netflix.search!.urlFor("x");
          rig.navigate(search);
          rig.navigate(search);
          await vi.advanceTimersByTimeAsync(500);
          expect(rig.events.filter((e) => e.type === "searchOpened")).toHaveLength(1);
          rig.navigate("https://www.netflix.com/browse");
          rig.navigate(search);
          await vi.advanceTimersByTimeAsync(500);
          expect(rig.events.filter((e) => e.type === "searchOpened")).toHaveLength(2);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("search", () => {
      test("typing with no field focused in the page goes to the App's search address", async () => {
        const rig = makeRig();
        await rig.show();
        rig.host.submitSearch("dark");
        await vi.waitFor(() => expect(rig.loads().at(-1)).toBe(netflix.search!.urlFor("dark")));
      });

      test("typing into a focused field in the page does not navigate", async () => {
        const rig = makeRig();
        await rig.show();
        const before = rig.loads().length;
        rig.answer("isField", true);
        rig.host.submitSearch("dark");
        await new Promise((r) => setTimeout(r, 20));
        expect(rig.loads()).toHaveLength(before);
      });

      test("the floating search bar is drawn in the page and removed again", async () => {
        const rig = makeRig();
        await rig.show();
        rig.host.showSearchBar("abc");
        expect(rig.scripts().at(-1)).toContain("couch-search");
        rig.host.showSearchBar(undefined);
        expect(rig.scripts().at(-1)).toContain("couch-search");
      });
    });
  });
}
