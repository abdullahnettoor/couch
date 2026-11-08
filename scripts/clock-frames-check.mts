// Frame-timing check for #35: Home's glass clock must not drop frames while a Wallpaper crossfades (the slideshow) or
// while the idle clock drifts.
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/clock-frames-check.mts [--baseline <renderer dir>]
// Needs the built Screen (`vp build`). It draws the REAL Screen (dist/renderer) in a hidden offscreen window at
// 1920 × 1080 and 60 fps, composited on the GPU, with two of Apple's Wallpapers converted by Couch's own converter and
// with Couch's built-ins, and in each scene times both the page's animation frames (requestAnimationFrame) and the
// composited frames the GPU hands back:
//   - the slideshow's crossfade on Home, and while idle (the clock drifting, the picture panning, the old one fading);
//   - the idle clock drifting over two built-ins and over a photo.
// A frame is dropped when the gap to the one before covers more than one 60 fps slot. A scene passes with at most 2 %
// of its slots dropped (either measure) and no gap over 50 ms. A positive control (Home under 64 full-screen blurs)
// must drop frames, or the run proves nothing and fails. It also times the minute's redraw of the clock's masks.
// `--baseline <renderer dir>` measures another build the same way (dev's, for today's clock) and prints both.
// No visible window opens; user data is a temp folder.
import { app, BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ElectronConverter } from "../src/main/ports/electron-pictures.ts";
import { dimFor } from "../src/shared/wallpapers.ts";
import { loadFixtures } from "./look-fixture-data.ts";

const SIZE = { width: 1920, height: 1080 };
const FPS = 60;
const SLOT = 1000 / FPS;
/** Each round of a scene is timed for this long; a crossfade (2.5 s) starts at its beginning. */
const ROUND_MS = 3000;
/** Rounds per scene: crossfades alternate between the two pictures, as the slideshow does. */
const ROUNDS = 3;
/** A scene passes with at most this share of its slots dropped, and no gap longer than LONGEST_MS. */
const DROPPED_AT_MOST = 0.02;
const LONGEST_MS = 50;
/** The positive control must drop at least this share, or the measure can't see a busy GPU. */
const CONTROL_DROPS_AT_LEAST = 0.1;
const CONTROL_BLURS = 64;
/** The minute's redraw of the clock (its render with the masks rewritten) takes at most this long. */
const REDRAW_MS = 12;
const APPLE = "/System/Library/Desktop Pictures";
const PICTURES = ["iMac Yellow.heic", "Sonoma.heic"];

app.setPath("userData", mkdtempSync(join(tmpdir(), "clock-frames-check-")));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.dock?.hide();

const args = process.argv.slice(2).filter((a) => !a.startsWith("--inspect"));
const baselineAt = args.indexOf("--baseline");
const builds: [string, string][] = [];
if (baselineAt >= 0) builds.push(["baseline", resolve(args[baselineAt + 1]!)]);
builds.push(["this build", join(import.meta.dirname, "../dist/renderer")]);

const scratch = mkdtempSync(join(tmpdir(), "clock-frames-preload-"));
const preload = join(scratch, "preload.cjs");
// The Screen's bridge, as look-snap-preload.cjs stands it in, but with the page's real animations and transitions.
writeFileSync(
  preload,
  `window.couch = { send() {}, reportGrid() {}, reportGlass() {}, onScreen: (l) => (window.__screen = l), onTint() {}, onSound() {}, onMpv() {} };`,
);

let failed = false;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` ${extra}` : ""}`);
  if (!ok) failed = true;
};

/** In page: times every animation frame for `ms` after `start()`, and checks `during()` half way through. */
const RECORD = `async (ms, start, during) => {
  const times = [];
  let seen = false;
  const done = new Promise((resolve) => {
    const step = (t) => {
      times.push(t);
      if (!seen && t - times[0] > ms / 2) seen = during();
      if (t - times[0] < ms) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  start();
  await done;
  return { times, seen };
}`;

interface Scene {
  name: string;
  /** What Home shows before timing starts. */
  setup: unknown;
  /** What it switches to as each round starts (a new picture starts a crossfade); none to just watch. */
  next?: (round: number) => unknown;
  /** In page: true while the scene is doing what it's named for (a crossfade running, the clock drifting). */
  during: string;
  /** Full-screen blurs laid over Home: the positive control. */
  blurs?: number;
}

/** Frame gaps: frames seen, 60 fps slots covered, slots missed, and the longest gap. */
interface Gaps {
  frames: number;
  slots: number;
  dropped: number;
  longest: number;
}

function gaps(times: number[]): Gaps {
  let dropped = 0;
  let longest = 0;
  for (let i = 1; i < times.length; i++) {
    const dt = times[i]! - times[i - 1]!;
    dropped += Math.max(0, Math.round(dt / SLOT) - 1);
    longest = Math.max(longest, dt);
  }
  return {
    frames: times.length - 1,
    slots: Math.round((times.at(-1)! - times[0]!) / SLOT),
    dropped,
    longest,
  };
}

const sum = (a: Gaps, b: Gaps): Gaps => ({
  frames: a.frames + b.frames,
  slots: a.slots + b.slots,
  dropped: a.dropped + b.dropped,
  longest: Math.max(a.longest, b.longest),
});
const share = (g: Gaps) => g.dropped / Math.max(1, g.slots);
const describe = (g: Gaps) =>
  `${g.dropped}/${g.slots} dropped (${(share(g) * 100).toFixed(1)} %), longest ${g.longest.toFixed(1)} ms`;

/** When each composited frame reached the main process. */
const composited: number[] = [];

function newWindow() {
  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    useContentSize: true,
    frame: false,
    backgroundColor: "#000000",
    webPreferences: {
      offscreen: { useSharedTexture: true },
      preload,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("paint", (event) => {
    composited.push(performance.now());
    event.texture?.release();
  });
  win.webContents.setFrameRate(FPS);
  return win;
}

async function time(win: BrowserWindow, renderer: string, scene: Scene) {
  let page: Gaps | undefined;
  let gpu: Gaps | undefined;
  let seen = true;
  await win.loadFile(join(renderer, "index.html"));
  await win.webContents.executeJavaScript(`window.__screen(${JSON.stringify(scene.setup)});0`);
  if (scene.blurs)
    await win.webContents.executeJavaScript(
      `for (let i = 0; i < ${scene.blurs}; i++) { const d = document.createElement("div"); d.style.cssText = "position:fixed;inset:0;backdrop-filter:blur(80px) saturate(1.5)"; document.body.append(d); }`,
    );
  // Settle: the pictures load and decode, and the first frames are drawn.
  await win.webContents.executeJavaScript("new Promise((r) => setTimeout(r, 1500))");
  for (let round = 0; round < ROUNDS; round++) {
    const start = scene.next
      ? `() => window.__screen(${JSON.stringify(scene.next(round))})`
      : "() => {}";
    composited.length = 0;
    const r = (await win.webContents.executeJavaScript(
      `(${RECORD})(${ROUND_MS}, ${start}, () => ${scene.during})`,
    )) as { times: number[]; seen: boolean };
    const p = gaps(r.times);
    const g = gaps(composited.slice(1));
    page = page ? sum(page, p) : p;
    gpu = gpu ? sum(gpu, g) : g;
    seen &&= r.seen;
  }
  return { page: page!, gpu: gpu!, seen };
}

/** How long a render takes when the minute changes (the time's text and the glass's masks), and when it doesn't. */
async function redraw(win: BrowserWindow, renderer: string, home: Record<string, unknown>) {
  await win.loadFile(join(renderer, "index.html"));
  return (await win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const at = (minute) => ({ ...${JSON.stringify(home)}, now: ${Number(home.now)} + minute * 60000 });
    window.__screen(at(0));
    await frame();
    const same = [], next = [];
    for (let m = 1; m <= 20; m++) {
      let t = performance.now();
      window.__screen({ ...at(m - 1), focusedId: "x" + m });
      void document.body.offsetHeight;
      same.push(performance.now() - t);
      await frame();
      t = performance.now();
      window.__screen(at(m));
      void document.body.offsetHeight;
      next.push(performance.now() - t);
      await frame();
    }
    const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    return { same: median(same), next: median(next), worst: Math.max(...next) };
  })()`)) as { same: number; next: number; worst: number };
}

void app.whenReady().then(async () => {
  try {
    const { screen } = loadFixtures();
    const converter = new ElectronConverter(join(app.getPath("userData"), "convert"));
    const photos: { file: string; name: string; dim: number }[] = [];
    for (const name of PICTURES) {
      const converted = await converter.convert(join(APPLE, name));
      if (!converted) throw new Error(`could not convert ${name}`);
      const file = join(app.getPath("userData"), `${name}.jpg`);
      writeFileSync(file, converted.jpeg);
      photos.push({ file, name, dim: dimFor(converted.brightness) });
    }
    const picture = (i: number) => ({
      wallpaper: { kind: "apple", file: photos[i % photos.length]!.name },
      pictures: photos.map((p) => ({
        kind: "apple",
        file: p.name,
        label: p.name,
        url: pathToFileURL(p.file).href,
        dim: p.dim,
      })),
      artwork: true,
    });
    const home = screen.home as unknown as Record<string, unknown>;
    const idle = screen["home-ambient"] as unknown as Record<string, unknown>;
    const crossfading = `!!document.querySelector(".h-photo-prev")`;
    const drifting = `document.getAnimations().some((a) => a.animationName === "h-clock-drift" && a.playState === "running")`;
    const slideshow = (base: Record<string, unknown>) => ({
      setup: { ...base, home: picture(0) },
      next: (round: number) => ({ ...base, home: picture(round + 1) }),
      during: crossfading,
    });
    const control: Scene = {
      name: `positive control: ${CONTROL_BLURS} full-screen blurs`,
      ...slideshow(idle),
      blurs: CONTROL_BLURS,
    };
    const scenes: Scene[] = [
      { name: "slideshow crossfade on Home", ...slideshow(home) },
      { name: "slideshow crossfade while idle", ...slideshow(idle) },
      { name: "idle clock drifting over Couch (built-in)", setup: idle, during: drifting },
      {
        name: "idle clock drifting over Dusk (built-in)",
        setup: { ...idle, home: { wallpaper: { kind: "builtin", id: "dusk" }, artwork: true } },
        during: drifting,
      },
      {
        name: "idle clock drifting over a photo",
        setup: { ...idle, home: picture(0) },
        during: drifting,
      },
    ];
    const win = newWindow();
    const heavy = await time(win, builds.at(-1)![1], control);
    console.log(
      `           ${control.name.padEnd(44)} page ${describe(heavy.page)}; composited ${describe(heavy.gpu)}`,
    );
    check(
      "the positive control drops frames, so a busy GPU shows in the timings",
      share(heavy.page) >= CONTROL_DROPS_AT_LEAST && share(heavy.gpu) >= CONTROL_DROPS_AT_LEAST,
      `page ${(share(heavy.page) * 100).toFixed(1)} %, composited ${(share(heavy.gpu) * 100).toFixed(1)} %`,
    );
    for (const scene of scenes) {
      for (const [label, renderer] of builds) {
        const t = await time(win, renderer, scene);
        console.log(
          `${label.padEnd(10)} ${scene.name.padEnd(44)} page ${describe(t.page)}; composited ${describe(t.gpu)}`,
        );
        if (label !== "this build") continue;
        check(
          `${scene.name}: the scene ran (${scene.during.includes("prev") ? "a crossfade" : "the drift"} seen)`,
          t.seen,
        );
        check(
          `${scene.name}: at most ${DROPPED_AT_MOST * 100} % of frames dropped, none longer than ${LONGEST_MS} ms`,
          [t.page, t.gpu].every((g) => share(g) <= DROPPED_AT_MOST && g.longest <= LONGEST_MS),
        );
      }
    }
    for (const [label, renderer] of builds) {
      const r = await redraw(win, renderer, home);
      console.log(
        `${label.padEnd(10)} a render: same minute ${r.same.toFixed(2)} ms; a new minute ${r.next.toFixed(2)} ms (worst ${r.worst.toFixed(2)} ms)`,
      );
      if (label === "this build")
        check(
          `the minute's redraw of the clock takes at most ${REDRAW_MS} ms`,
          r.worst <= REDRAW_MS,
          `worst ${r.worst.toFixed(2)} ms`,
        );
    }
    win.destroy();
  } catch (error) {
    console.error(
      `FAIL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    failed = true;
  }
  app.exit(failed ? 1 : 0);
});
