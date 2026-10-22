import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { playbackProbe } from "../../web/playback.ts";
import { youtubeDescription } from "./youtube-web.ts";

const playback = youtubeDescription("1.0.0").playback!;

class FakePlayer {
  position = 40;
  captions: boolean | undefined = false;
  clicked: string[] = [];
  video: Record<string, unknown> = {
    get currentTime() {
      return player.position;
    },
    set currentTime(v: number) {
      player.position = v;
    },
    duration: 212,
    paused: false,
    readyState: 4,
    getBoundingClientRect: () => ({ width: 1920, height: 1080 }),
  };
  hash: string;
  constructor(hash: string) {
    this.hash = hash;
  }
  button() {
    if (this.captions === undefined) return null;
    const self = this;
    return {
      getAttribute: (n: string) => (n === "aria-pressed" ? String(self.captions) : null),
      dispatchEvent: (e: { type: string }) => {
        self.clicked.push(e.type);
        if (e.type === "click") self.captions = !self.captions;
        return true;
      },
    };
  }
  run(source: string): any {
    const self = this;
    const sandbox: any = {
      innerWidth: 1920,
      innerHeight: 1080,
      location: { hash: this.hash },
      document: {
        querySelectorAll: (sel: string) => (sel === "video" ? [self.video] : []),
        querySelector: (sel: string) =>
          sel === "video"
            ? self.video
            : sel === "ytlr-captions-button yt-button-container"
              ? self.button()
              : null,
      },
      navigator: {},
      MouseEvent: class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return vm.runInContext(source, sandbox);
  }
}
let player: FakePlayer;
const watching = () => (player = new FakePlayer("#/watch?v=dQw4w9WgXcQ"));

describe("YouTube playback adapter", () => {
  test("seek sets the video's position", () => {
    watching();
    player.run(playback.seek!(95.6));
    expect(player.position).toBe(95.6);
  });

  test("subtitles: Off and On follow the captions button", async () => {
    watching();
    expect(await player.run(`(${playback.tracks!()})`)).toEqual({
      subtitles: [
        { id: "off", label: "Off", on: true },
        { id: "on", label: "On", on: false },
      ],
      audio: [],
    });
    player.captions = true;
    expect((await player.run(`(${playback.tracks!()})`)).subtitles.map((t: any) => t.on)).toEqual([
      false,
      true,
    ]);
  });

  test("setTrack presses the button only when the state would change", () => {
    watching();
    player.run(playback.setTrack!("subtitles", "off"));
    expect(player.clicked).toEqual([]);
    player.run(playback.setTrack!("subtitles", "on"));
    expect(player.captions).toBe(true);
    player.run(playback.setTrack!("subtitles", "on"));
    expect(player.captions).toBe(true);
    player.run(playback.setTrack!("subtitles", "off"));
    expect(player.captions).toBe(false);
    player.run(playback.setTrack!("audio", "a1"));
    expect(player.captions).toBe(false);
  });

  test("a video without captions: no pickers", async () => {
    watching();
    player.captions = undefined;
    expect(await player.run(`(${playback.tracks!()})`)).toBeFalsy();
    expect(() => player.run(playback.setTrack!("subtitles", "on"))).not.toThrow();
  });

  test("only the watch view is Now Playing: Home's autoplaying preview is not", async () => {
    const probe = (hash: string) => {
      player = new FakePlayer(hash);
      return player.run(playbackProbe({ tracks: playback.tracks!(), active: playback.active!() }));
    };
    expect(await probe("#/watch?v=dQw4w9WgXcQ&list=RD1")).toMatchObject({
      position: 40,
      duration: 212,
    });
    for (const hash of ["", "#/", "#/browse?c=FEsubscriptions", "#/search?q=cats"])
      expect(await probe(hash)).toBeUndefined();
  });
});
