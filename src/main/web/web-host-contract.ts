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
  /** Everything the host has the engine run before the page's own scripts, in every world (preloads, user scripts). */
  installed(): string;
  /** Whether the host hides the page's scrollbars (a user style, or a script that adds one). */
  hidesScrollbars(): boolean;
  /** The household presses the mouse on the page itself. */
  pageMouseDown(): void;
  /** The page calls `couchHost.send(message)` (the engine's own bridge script, run for real), from a frame (default: the App's main frame). */
  couchSend(message: unknown, frame?: { main: boolean; origin: string }): void;
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

    describe("Now Playing: prompts, tracks, speed, artwork", () => {
      const report = {
        position: 30,
        duration: 3000,
        paused: false,
        title: "Test Pattern",
        speed: 1.5,
        prompt: { id: "skipIntro", label: "Skip Intro" },
        tracks: {
          subtitles: [{ id: "s1", label: "English", on: true }],
          audio: [{ id: "a1", label: "English", on: true }],
          speed: 1.5,
          speeds: [0.5, 1, 1.5, 2],
          canSeek: true,
        },
        artwork: "https://occ-0-1.nflximg.net/box.jpg",
      };
      const reported = async (answer: unknown) => {
        vi.useFakeTimers();
        try {
          const rig = makeRig();
          await rig.show();
          rig.answer('querySelectorAll("video")', answer);
          await vi.advanceTimersByTimeAsync(500);
          return rig.events.flatMap((e) =>
            e.type === "playback" && e.playback ? [e.playback] : [],
          );
        } finally {
          vi.useRealTimers();
        }
      };

      test("a prompt the page shows (Skip Intro) is reported with its label", async () => {
        expect((await reported(report)).at(-1)?.prompt).toEqual({
          id: "skipIntro",
          label: "Skip Intro",
        });
      });

      test("subtitle and audio tracks, the speeds on offer and the speed in use are reported, and seeking is allowed", async () => {
        const last = (await reported(report)).at(-1)!;
        expect(last.tracks).toEqual({
          subtitles: report.tracks.subtitles,
          audio: report.tracks.audio,
        });
        expect(last.speeds).toEqual([0.5, 1, 1.5, 2]);
        expect(last.speed).toBe(1.5);
        expect(last.canSeek).toBe(true);
      });

      test("artwork from the App's own hosts is reported; from anywhere else it is dropped", async () => {
        expect((await reported(report)).at(-1)?.artwork).toBe(report.artwork);
        const other = { ...report, artwork: "https://evil.example/pixel.jpg" };
        expect((await reported(other)).at(-1)?.artwork).toBeUndefined();
        const plain = { ...report, artwork: "http://occ-0-1.nflximg.net/box.jpg" };
        expect((await reported(plain)).at(-1)?.artwork).toBeUndefined();
      });

      test("a page that is not playing (a home preview) reports nothing", async () => {
        expect(await reported(undefined)).toEqual([]);
      });
    });

    describe("page scripts and the host bridge", () => {
      test("the App's own preload (Netflix's box-art recorder) runs before the page's scripts", async () => {
        const rig = makeRig();
        await rig.show();
        for (const p of netflix.preloads) expect(rig.installed()).toContain(p.func);
      });

      test("Couch's focus runs in the page with the App's layout (rows, Play-first pop-up, the player bar)", async () => {
        const rig = makeRig();
        await rig.show();
        const installed = rig.installed();
        expect(installed).toContain("__couchFocus");
        expect(installed).toContain(JSON.stringify(netflix.focus!.layout));
      });

      test("a page hook layer exists", async () => {
        const rig = makeRig();
        await rig.show();
        expect(rig.installed()).toContain("couchHooks");
      });

      describe("couchHost.send reaches the host", () => {
        const url = "https://www.netflix.com/watch/80018499";
        const route = { type: "route", url, page: { y: 0, modal: false } };
        const routes = (rig: HostRig) => rig.events.filter((e) => e.type === "route");

        test("a route message becomes the route event", async () => {
          const rig = makeRig();
          await rig.show();
          rig.events.length = 0;
          rig.couchSend(route);
          expect(routes(rig)).toContainEqual(expect.objectContaining({ home: false }));
        });

        test("a confirmation answer reaches the host while a prompt is open", async () => {
          const rig = makeRig();
          await rig.show();
          rig.host.showConfirm({ title: "Leave?", buttons: ["Leave", "Stay"], focus: 0 });
          rig.events.length = 0;
          rig.couchSend({ type: "console", message: "couch:confirm:1" });
          expect(rig.events).toEqual([{ type: "confirm", index: 1, answer: true }]);
        });

        test("input and wake-pointer have native paths, so a message for them emits nothing here", async () => {
          const rig = makeRig();
          await rig.show();
          rig.events.length = 0;
          rig.couchSend({ type: "wake-pointer", x: 10, y: 10 });
          expect(rig.events).toEqual([]);
        });

        test.each([
          ["a sub-frame of the App", { main: false, origin: "https://www.netflix.com" }],
          ["another origin's main frame", { main: true, origin: "https://evil.example" }],
        ])("%s is dropped", async (_name, frame) => {
          const rig = makeRig();
          await rig.show();
          rig.host.showConfirm({ title: "Leave?", buttons: ["Leave", "Stay"], focus: 0 });
          rig.events.length = 0;
          rig.couchSend(route, frame);
          rig.couchSend({ type: "console", message: "couch:confirm:0" }, frame);
          expect(rig.events).toEqual([]);
        });

        test("a malformed message is dropped", async () => {
          const rig = makeRig();
          await rig.show();
          rig.events.length = 0;
          rig.couchSend({ type: "route", url: "http://insecure.example/", page: null });
          rig.couchSend({ type: "console", message: "hello" });
          rig.couchSend({ type: "nope" });
          expect(rig.events).toEqual([]);
        });
      });

      test("hideScrollbars: the host hides the page's scrollbars", async () => {
        const rig = makeRig();
        await rig.show();
        rig.loaded();
        expect(netflix.hideScrollbars).toBe(true);
        expect(rig.hidesScrollbars()).toBe(true);
      });

      test("a mouse press on the page is the household's input; one while Couch captures typing is not", async () => {
        const rig = makeRig();
        await rig.show();
        rig.events.length = 0;
        rig.pageMouseDown();
        expect(rig.events).toEqual([{ type: "input" }]);
        rig.host.captureText(true);
        rig.events.length = 0;
        rig.pageMouseDown();
        expect(rig.events).toEqual([]);
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

      test("a finished load reports where the page is, even before any navigation event", async () => {
        const rig = makeRig();
        await rig.show();
        rig.loaded();
        expect(rig.events).toContainEqual(expect.objectContaining({ type: "route", home: true }));
        expect(rig.events).toContainEqual({ type: "loaded" });
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
