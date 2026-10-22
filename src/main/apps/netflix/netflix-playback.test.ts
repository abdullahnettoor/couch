import vm from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { composeReport, playbackProbe } from "../../web/playback.ts";
import { netflixDescription } from "./netflix-web.ts";

const playback = netflixDescription("130.0.0.0").playback!;

type Handler = (e: any) => void;

class El {
  listeners: Record<string, Handler[]> = {};
  uia: string;
  attrs: Record<string, string>;
  text: string;
  onClick: () => void;
  rect: { left: number; top: number; width: number; height: number };
  constructor(
    uia: string,
    attrs: Record<string, string> = {},
    text = "",
    onClick: () => void = () => {},
    rect = { left: 0, top: 0, width: 0, height: 0 },
  ) {
    this.uia = uia;
    this.attrs = attrs;
    this.text = text;
    this.onClick = onClick;
    this.rect = rect;
  }
  getAttribute(n: string) {
    return n === "data-uia" ? this.uia : (this.attrs[n] ?? null);
  }
  get textContent() {
    return this.text;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  click() {
    this.onClick();
  }
  dispatchEvent(e: any) {
    (this.listeners[e.type] ?? []).forEach((h) => h(e));
    return true;
  }
  addEventListener(t: string, h: Handler) {
    (this.listeners[t] ??= []).push(h);
  }
}

/** The Netflix player as recorded (anonymised titles): the bar mounts when the pointer moves over the page and hides when asked. */
class FakeNetflix {
  path = "/watch/1";
  position = 30;
  duration = 3000;
  barOn = false;
  menuOn = false;
  /** What Netflix's player has: set false to model a redesign that drops them. */
  hasTimeline = true;
  hasMenuButton = true;
  hasPlayPause = true;
  playPauseClicks = 0;
  playPauseButton = new El("control-play-pause-pause", {}, "", () => {
    this.playPauseClicks++;
    this.video.paused = !this.video.paused;
  });
  audio = ["One", "Two", "Three"];
  subs = ["Off", "One", "Two"];
  audioOn = "One";
  subOn = "One";
  timeline = new El("timeline", {}, "", () => {}, { left: 18, top: 560, width: 1000, height: 20 });
  knob = new El("timeline-knob", { "aria-valuemax": String(this.duration * 1000) });
  menuButton = new El("control-audio-subtitle", {}, "", () => {
    this.menuOn = true;
    this.menuOpened++;
  });
  menuOpened = 0;
  /** Netflix's overlay buttons by data-uia (anonymised text); they sit outside the bar. */
  overlays = new Map<string, El>();
  addOverlay(uia: string, text: string, visible = true) {
    const el = new El(uia, {}, text, () => this.overlays.delete(uia), {
      left: 0,
      top: 0,
      width: visible ? 160 : 0,
      height: visible ? 48 : 0,
    });
    this.overlays.set(uia, el);
    return el;
  }
  reveals = 0;
  seekClicks: { x: number; types: string[] }[] = [];
  video: any;
  constructor() {
    const self = this;
    this.video = {
      get currentTime() {
        return self.position;
      },
      set currentTime(_v: number) {
        throw new Error("setting video.currentTime breaks Netflix's player");
      },
      duration: this.duration,
      paused: false,
      readyState: 4,
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    };
    this.timeline.dispatchEvent = (e: any) => {
      let cur = this.seekClicks[this.seekClicks.length - 1];
      if (!cur || e.type === "pointerover") {
        cur = { x: e.clientX, types: [] };
        this.seekClicks.push(cur);
      }
      cur.types.push(e.type);
      cur.x = e.clientX;
      if (e.type === "click")
        this.position = ((cur.x - 18) / 1000) * (Number(this.knob.attrs["aria-valuemax"]) / 1000);
      return true;
    };
  }
  menuItems(): El[] {
    const item = (kind: string, name: string, on: boolean) =>
      new El(`${kind}-item${on ? "-selected" : ""}-${name}`, {}, name, () => {
        if (kind === "audio") this.audioOn = name;
        else this.subOn = name;
      });
    return [
      ...this.audio.map((n) => item("audio", n, n === this.audioOn)),
      ...this.subs.map((n) => item("subtitle", n, n === this.subOn)),
    ];
  }
  menu() {
    const m = new El("selector-audio-subtitle");
    (m as any).querySelectorAll = (s: string) => (s === "li" ? this.menuItems() : []);
    m.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.menuOn = false;
    });
    this.menuEl = m;
    return m;
  }
  menuEl: El | undefined;
  query(sel: string): El | null {
    const uia = /^\[data-uia=([\w-]+)\]$/.exec(sel)?.[1];
    if (sel === "video") return this.video;
    if (uia && this.overlays.has(uia)) return this.overlays.get(uia)!;
    if (uia === "selector-audio-subtitle") return this.menuOn ? (this.menuEl ?? this.menu()) : null;
    if (!this.barOn) return null;
    if (this.menuOn && (uia === "timeline" || uia === "timeline-knob")) return null;
    if (uia === "timeline") return this.hasTimeline ? this.timeline : null;
    if (uia === "timeline-knob") return this.hasTimeline ? this.knob : null;
    if (uia === "control-play-pause-pause" || uia === "control-play-pause-play") {
      const want = this.video.paused ? "play" : "pause";
      return this.hasPlayPause && uia === `control-play-pause-${want}`
        ? this.playPauseButton
        : null;
    }
    if (uia === "control-audio-subtitle") return this.hasMenuButton ? this.menuButton : null;
    return null;
  }
  run(source: string): any {
    return vm.runInContext(source, (this.sandbox ??= this.makeSandbox()));
  }
  makeSandbox(): any {
    const sandbox: any = {
      innerWidth: 1280,
      innerHeight: 720,
      location: {
        get pathname() {
          return self.path;
        },
      },
      setTimeout: (f: () => void) => {
        f();
        return 0;
      },
      document: {
        querySelector: (s: string) => this.query(s),
        querySelectorAll: (s: string) => (s === "video" ? [this.video] : []),
        elementFromPoint: () => ({
          dispatchEvent: (e: any) => {
            if (e.type === "mousemove") {
              this.reveals++;
              this.barOn = true;
            }
          },
        }),
      },
      navigator: {},
      PointerEvent: class {
        type: string;
        constructor(type: string, init: any) {
          this.type = type;
          Object.assign(this, init);
        }
      },
      MouseEvent: class {
        type: string;
        constructor(type: string, init: any) {
          this.type = type;
          Object.assign(this, init);
        }
      },
      KeyboardEvent: class {
        type: string;
        constructor(type: string, init: any) {
          this.type = type;
          Object.assign(this, init);
        }
      },
    };
    const self = this;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return sandbox;
  }
  sandbox: any;
}
const tracks = (n: FakeNetflix) => n.run(playback.tracks!());

describe("Netflix playback adapter", () => {
  test("only the player (/watch) is Now Playing: browse's billboard trailer is not", async () => {
    const probe = (path: string) => {
      const n = new FakeNetflix();
      n.path = path;
      return n.run(playbackProbe({ tracks: playback.tracks!(), active: playback.active!() }));
    };
    expect(await probe("/watch/80000001")).toMatchObject({ position: 30, duration: 3000 });
    for (const p of ["/browse", "/browse?jbv=1", "/search?q=x", "/title/1"])
      expect(await probe(p)).toBeUndefined();
  });

  test("seek clicks Netflix's own timeline at the point; it never sets the video's position", async () => {
    const n = new FakeNetflix();
    await n.run(playback.seek!(1500));
    expect(n.position).toBeCloseTo(1500, 0);
    expect(n.seekClicks.at(-1)!.types).toEqual([
      "pointerover",
      "pointermove",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ]);
    await n.run(playback.seek!(-5));
    expect(n.position).toBe(0);
    await n.run(playback.seek!(99999));
    expect(n.position).toBeCloseTo(3000, 0);
  });

  test("play/pause presses Netflix's own button, bringing its bar up first, and toggles back", async () => {
    const n = new FakeNetflix();
    await n.run(playback.playPause!());
    expect(n.video.paused).toBe(true);
    expect(n.reveals).toBeGreaterThan(0);
    await n.run(playback.playPause!());
    expect(n.video.paused).toBe(false);
    expect(n.playPauseClicks).toBe(2);
  });

  test("play/pause with the button missing leaves the player alone", async () => {
    const n = new FakeNetflix();
    n.hasPlayPause = false;
    await expect(n.run(playback.playPause!())).resolves.toBeUndefined();
    expect(n.video.paused).toBe(false);
  });

  test("tracks: reads the audio and subtitle menu, then puts it away", async () => {
    const n = new FakeNetflix();
    expect(await tracks(n)).toEqual({
      canSeek: true,
      audio: [
        { id: "One", label: "One", on: true },
        { id: "Two", label: "Two", on: false },
        { id: "Three", label: "Three", on: false },
      ],
      subtitles: [
        { id: "Off", label: "Off", on: false },
        { id: "One", label: "One", on: true },
        { id: "Two", label: "Two", on: false },
      ],
    });
    expect(n.menuOn).toBe(false);
  });

  test("tracks are read once per title, not every poll", async () => {
    const n = new FakeNetflix();
    await tracks(n);
    await tracks(n);
    await tracks(n);
    expect(n.menuOpened).toBe(1);
    n.path = "/watch/2";
    n.barOn = false;
    await tracks(n);
    expect(n.menuOpened).toBe(2);
  });

  test("a menu the household opened on the TV is read as it is, and left open", async () => {
    const n = new FakeNetflix();
    n.barOn = n.menuOn = true;
    n.subOn = "Two";
    const t = await tracks(n);
    expect(t.subtitles.find((s: any) => s.on).id).toBe("Two");
    expect(n.menuOn).toBe(true);
    expect(n.menuOpened).toBe(0);
  });

  test("setTrack clicks the item in Netflix's menu and the next read shows it", async () => {
    const n = new FakeNetflix();
    await tracks(n);
    await n.run(playback.setTrack!("audio", "Three"));
    await n.run(playback.setTrack!("subtitles", "Off"));
    expect([n.audioOn, n.subOn]).toEqual(["Three", "Off"]);
    expect(n.menuOn).toBe(false);
    const t = await tracks(n);
    expect(t.audio.find((a: any) => a.on).id).toBe("Three");
    expect(t.subtitles.find((a: any) => a.on).id).toBe("Off");
    await n.run(playback.setTrack!("audio", "Nonexistent"));
    expect(n.audioOn).toBe("Three");
  });

  test("controls that aren't there: nothing offered, and the seek bar is read-only", async () => {
    const n = new FakeNetflix();
    n.hasTimeline = false;
    n.hasMenuButton = false;
    const t = await tracks(n);
    expect(t).toEqual({ subtitles: [], audio: [], canSeek: false });
    const found = await n.run(
      playbackProbe({ tracks: playback.tracks!(), active: playback.active!() }),
    );
    const report = composeReport(found, found.tracks, true)!;
    expect(report.canSeek).toBeUndefined();
    expect(report.tracks).toEqual({ subtitles: [], audio: [] });
    await expect(n.run(playback.seek!(100))).resolves.toBeUndefined();
    await expect(n.run(playback.setTrack!("audio", "One"))).resolves.toBeUndefined();
    expect(n.position).toBe(30);
  });

  test("a missing seek bar alone keeps the pickers", async () => {
    const n = new FakeNetflix();
    n.hasTimeline = false;
    const t = await tracks(n);
    expect(t.canSeek).toBe(false);
    expect(t.audio).toHaveLength(3);
  });

  test("while the household is on the bar, nothing is poked: the poll waits", async () => {
    const n = new FakeNetflix();
    n.barOn = true;
    const t = await tracks(n);
    expect(t).toEqual({ subtitles: [], audio: [], canSeek: true });
    expect(n.menuOpened).toBe(0);
    expect(n.reveals).toBe(0);
  });
});

describe("Netflix prompts", () => {
  const probe = (n: FakeNetflix) =>
    n.run(playbackProbe({ active: playback.active!(), prompt: playback.prompt!() }));

  test("no prompt while no overlay button is showing", async () => {
    const n = new FakeNetflix();
    expect((await probe(n)).prompt).toBeUndefined();
    n.addOverlay("player-skip-intro", "Skip Intro", false);
    expect((await probe(n)).prompt).toBeUndefined();
  });

  test.each([
    ["player-skip-intro", "skipIntro", "Skip Intro"],
    ["player-skip-recap", "skipRecap", "Skip Recap"],
    ["next-episode-seamless-button", "nextEpisode", "Next Episode"],
    ["next-episode-seamless-button-draining", "nextEpisode", "Next Episode"],
  ])("%s is reported as %s with the page's own label", async (uia, id, label) => {
    const n = new FakeNetflix();
    n.addOverlay(uia, `  ${label}\n `);
    expect((await probe(n)).prompt).toEqual({ id, label });
  });

  test("an empty label falls back to the prompt's name", async () => {
    const n = new FakeNetflix();
    n.addOverlay("player-skip-recap", "");
    expect((await probe(n)).prompt).toEqual({ id: "skipRecap", label: "Skip Recap" });
  });

  test("pressPrompt clicks that button, and only a showing one", async () => {
    const n = new FakeNetflix();
    n.addOverlay("player-skip-intro", "Skip Intro");
    n.run(playback.pressPrompt!("nextEpisode"));
    expect(n.overlays.has("player-skip-intro")).toBe(true);
    n.run(playback.pressPrompt!("skipIntro"));
    expect(n.overlays.has("player-skip-intro")).toBe(false);
    expect((await probe(n)).prompt).toBeUndefined();
  });

  test("the prompt survives composeReport", async () => {
    const n = new FakeNetflix();
    n.addOverlay("player-skip-intro", "Skip Intro");
    const report = composeReport(await probe(n), undefined, true)!;
    expect(report.prompt).toEqual({ id: "skipIntro", label: "Skip Intro" });
  });
});
