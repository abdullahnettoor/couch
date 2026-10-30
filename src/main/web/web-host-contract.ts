import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { netflixDescription } from "../apps/netflix/netflix-web.ts";
import type { YouTube, YouTubeEvent } from "../ports/youtube.ts";
import type { PlaybackAdapter, WebAppDescription } from "./web-app.ts";
import { urlRoute } from "./url-route.ts";
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
  /** Disposes the host (its view, listeners and timers). Safe to call twice. */
  dispose(): void;
  /** Something reached the page that plays or pauses its media: a native media key, or the media element's play/pause run in the page. */
  playPauseDelivered(): boolean;
  /** Every script the host ran in the page. */
  scripts(): string[];
  /** The key codes pressed natively, in order (key down only). */
  keys(): string[];
  /** The page moves to `url` without a reload (a pushState). */
  navigate(url: string): void;
  /** Every address the host asked the page to load. */
  loads(): string[];
  /**
   * The page's top frame is about to go to `url` (a link or script: "navigate"; a server's redirect: "redirect").
   * True when the host lets it proceed, false when it cancels it.
   */
  navigateTop(url: string, kind: "navigate" | "redirect"): boolean;
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

const DEMOFLIX = "https://www.demoflix.example";
/** A neutral site with no playback adapter, search or preloads: the host's own fallbacks are all it has. */
export const demoflixDescription: WebAppDescription = {
  id: "demoflix",
  url: `${DEMOFLIX}/`,
  partition: "persist:demoflix",
  identity: contractDescription.identity,
  keyCodes: contractDescription.keyCodes,
  isOwnOrigin: (origin) => origin === DEMOFLIX,
  route: urlRoute((url) => url.pathname === "/"),
  preloads: [],
  addons: [],
  enabledAddons: [],
};
const netflix = contractDescription;
const playing = { position: 12, duration: 3000, paused: false, title: "Test Pattern" };

/** The behaviour every web-App host shares, whatever engine draws the page. Run against each adapter. */
export function describeWebHostContract(
  name: string,
  make: (description: WebAppDescription) => HostRig,
): void {
  describe(`web host contract: ${name}`, () => {
    // Every rig is disposed after its test, and before fake timers are restored (a timer the host armed must not outlive its clock).
    const rigs: HostRig[] = [];
    const makeRig = (description: WebAppDescription = contractDescription): HostRig => {
      const rig = make(description);
      rigs.push(rig);
      return rig;
    };
    const disposeRigs = () => {
      for (const rig of rigs.splice(0)) rig.dispose();
    };
    afterEach(() => {
      disposeRigs();
      vi.useRealTimers();
    });

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
          disposeRigs();
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
          disposeRigs();
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
          disposeRigs();
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
          disposeRigs();
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
          disposeRigs();
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

      test("the header's title and the title id the page names are reported as they are", async () => {
        const named = {
          ...report,
          title: "Some Show \u00b7 S1:E2 \u00b7 Second",
          id: "70000101",
        };
        expect((await reported(named)).at(-1)).toMatchObject({
          title: "Some Show \u00b7 S1:E2 \u00b7 Second",
          id: "70000101",
        });
      });

      test("the probe the host runs reads the player header, the title id and the art records", async () => {
        vi.useFakeTimers();
        try {
          const rig = makeRig();
          await rig.show();
          rig.answer('querySelectorAll("video")', report);
          await vi.advanceTimersByTimeAsync(500);
          const probe = rig.scripts().find((x) => x.includes('querySelectorAll("video")'))!;
          expect(probe).toContain("video-title");
          expect(probe).toContain("couchNfArt");
          expect(probe).toContain("report.id");
        } finally {
          disposeRigs();
          vi.useRealTimers();
        }
      });

      test("a page that is not playing (a home preview) reports nothing", async () => {
        expect(await reported(undefined)).toEqual([]);
      });
    });

    describe("play/pause", () => {
      test("a page with no playback adapter gets play/pause delivered all the same", async () => {
        const rig = makeRig(demoflixDescription);
        await rig.show();
        rig.host.playPause();
        expect(rig.playPauseDelivered()).toBe(true);
      });

      test("the App's adapter does it in its own way, and nothing else is sent", async () => {
        const rig = makeRig();
        await rig.show();
        rig.host.playPause();
        expect(rig.scripts().at(-1)).toBe(
          (netflix.playback as Required<PlaybackAdapter>).playPause(),
        );
        expect(rig.playPauseDelivered()).toBe(false);
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

    describe("the resume address in the report", () => {
      const report = async (url: string, answer: unknown = playing) => {
        vi.useFakeTimers();
        const rig = makeRig();
        await rig.show();
        rig.navigate(url);
        rig.answer('querySelectorAll("video")', answer);
        await vi.advanceTimersByTimeAsync(500);
        return rig.events.filter((e) => e.type === "playback").at(-1) as
          | { playback?: { resume?: string } }
          | undefined;
      };

      test("a watch page gets the address the description builds for it", async () => {
        const last = await report("https://www.netflix.com/watch/80100172?trackId=1");
        expect(last?.playback?.resume).toBe("https://www.netflix.com/watch/80100172");
      });

      test("an ad playing on a valid watch address gets none: the ad is not the title", async () => {
        const last = await report("https://www.netflix.com/watch/80100172", {
          ...playing,
          ad: true,
        });
        expect(last?.playback).toMatchObject({ ad: true });
        expect(last?.playback?.resume).toBeUndefined();
      });

      test("a page the description refuses gets none", async () => {
        const last = await report("https://www.netflix.com/browse?jbv=80100172");
        expect(last?.playback).toBeDefined();
        expect(last?.playback?.resume).toBeUndefined();
      });
    });

    describe("opening at an address", () => {
      const title = "https://www.netflix.com/watch/80100172";
      /** Pages asked for, leaving out the blank one Chromium starts on. */
      const pages = (rig: HostRig) => rig.loads().filter((u) => u !== "about:blank");

      test("before the first load, the App's first page is that address, not its home", async () => {
        const rig = makeRig();
        rig.host.openAt(title);
        await rig.show();
        expect(pages(rig)).toEqual([title]);
      });

      test("a later show goes home again", async () => {
        const rig = makeRig();
        rig.host.openAt(title);
        await rig.show();
        rig.host.hide();
        rig.host.restart();
        await vi.waitFor(() => expect(rig.loads().at(-1)).toBe(netflix.url));
      });

      test("with the page already loaded, the page goes there", async () => {
        const rig = makeRig();
        await rig.show();
        rig.loaded();
        rig.host.openAt(title);
        expect(rig.loads().at(-1)).toBe(title);
      });

      test.each([
        ["another site", "https://www.example.com/watch/80100172"],
        ["a look-alike host", "https://www.netflix.com.evil.example/watch/1"],
        ["plain http", "http://www.netflix.com/watch/80100172"],
        ["a script", "javascript:alert(1)"],
        ["data", "data:text/html,<script>1</script>"],
        ["not a URL", "nonsense"],
        ["an own-origin page that is not a title", "https://www.netflix.com/browse"],
        ["an own-origin account page", "https://www.netflix.com/YourAccount"],
        ["a title's pop-up", "https://www.netflix.com/title/80100172"],
        ["a watch address with extras", "https://www.netflix.com/watch/80100172?trackId=1"],
        ["a watch address with a path after it", "https://www.netflix.com/watch/80100172/x"],
        ["a malformed id", "https://www.netflix.com/watch/abc"],
        ["a country prefix (not the canonical shape)", "https://www.netflix.com/gb/watch/80100172"],
      ])("refuses %s", async (_n, url) => {
        const rig = makeRig();
        await rig.show();
        rig.loaded();
        const before = rig.loads().length;
        rig.host.openAt(url);
        expect(rig.loads()).toHaveLength(before);
      });

      test("a site whose description has no resume address takes no openAt", async () => {
        const rig = makeRig(demoflixDescription);
        await rig.show();
        rig.loaded();
        const before = rig.loads().length;
        rig.host.openAt(`${DEMOFLIX}/watch/1`);
        expect(rig.loads()).toHaveLength(before);
      });

      test("a refused address before the first load leaves the home as the first page", async () => {
        const rig = makeRig();
        rig.host.openAt("https://www.example.com/x");
        await rig.show();
        expect(pages(rig)).toEqual([netflix.url]);
      });
    });

    describe("navigation while a Continue open is pending", () => {
      const title = "https://www.netflix.com/watch/80100172";
      const blocked = (rig: HostRig) => rig.events.filter((e) => e.type === "blocked").length;
      const pending = async () => {
        const rig = makeRig();
        await rig.show();
        rig.loaded();
        rig.host.openAt(title);
        return rig;
      };

      test("a redirect to another site is cancelled, the App goes home and says so", async () => {
        const rig = await pending();
        const before = rig.loads().length;
        expect(rig.navigateTop("https://phish.example/netflix", "redirect")).toBe(false);
        expect(blocked(rig)).toBe(1);
        await vi.waitFor(() => expect(rig.loads().slice(before)).toEqual([netflix.url]));
      });

      test("so is a navigation to another site, a look-alike host, plain http, data: and javascript:", async () => {
        for (const url of [
          "https://phish.example/x",
          "https://www.netflix.com.evil.example/x",
          "http://www.netflix.com/watch/1",
          "data:text/html,<script>alert(1)</script>",
          "javascript:alert(1)",
        ]) {
          const rig = await pending();
          expect(rig.navigateTop(url, "navigate"), url).toBe(false);
          expect(blocked(rig), url).toBe(1);
          disposeRigs();
        }
      });

      test("the App's own pages are let through (a sign-in redirect, the title itself)", async () => {
        const rig = await pending();
        expect(rig.navigateTop(title, "navigate")).toBe(true);
        expect(rig.navigateTop("https://www.netflix.com/login", "redirect")).toBe(true);
        expect(rig.navigateTop("https://help.netflix.com/en", "navigate")).toBe(true);
        expect(blocked(rig)).toBe(0);
      });

      test("once the page has loaded, nothing is held back any more", async () => {
        const rig = await pending();
        rig.loaded();
        expect(rig.navigateTop("https://accounts.example/sso", "navigate")).toBe(true);
        expect(blocked(rig)).toBe(0);
      });

      test("with no Continue open pending, the host does not police navigation at all", async () => {
        const rig = makeRig();
        await rig.show();
        rig.loaded();
        expect(rig.navigateTop("https://accounts.example/sso", "navigate")).toBe(true);
        expect(blocked(rig)).toBe(0);
      });

      test("a refused openAt does not start the policy", async () => {
        const rig = makeRig();
        await rig.show();
        rig.loaded();
        rig.host.openAt("https://www.example.com/x");
        expect(rig.navigateTop("https://accounts.example/sso", "navigate")).toBe(true);
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
          disposeRigs();
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
