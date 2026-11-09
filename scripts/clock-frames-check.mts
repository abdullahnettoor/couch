// Frame-timing check for #35: Home's glass clock must not drop frames while a Wallpaper crossfades (the slideshow) or
// while the idle clock drifts.
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/clock-frames-check.mts [--baseline <renderer dir>]
// Needs the built Screen (`vp build`). It draws the REAL Screen (dist/renderer) in a hidden offscreen window at
// 1920 × 1080 and 60 fps, composited on the GPU, with two of Apple's Wallpapers converted by Couch's own converter and
// with Couch's built-ins, and in each scene times both the page's animation frames (requestAnimationFrame) and the
// composited frames the GPU hands back:
//   - the slideshow's crossfade on Home, and while idle (the clock drifting, the picture panning, the old one fading);
//   - the idle clock drifting over two built-ins and over a photo.
// A frame is dropped when the gap to the one before covers more than one 60 fps slot; each round is timed over a fixed
// 3 s from the moment it starts, so the gaps before its first frame and after its last count too (the composited
// frames are placed on the page's interval by wall time). A scene passes with at most 2 % of its slots dropped (either
// measure), no gap over 50 ms, and frames for at least 95 % of its slots (either measure). Two controls must show up,
// or the run proves nothing and fails: Home under 64 full-screen blurs must drop frames, and a 200 ms stall (the page
// busy, painting stopped) as each round starts must show as a gap in both measures. It also times the minute's redraw
// of the clock's masks, and checks that the clock's tint and the photo's dim follow the crossfade.
// `--baseline <renderer dir>` measures another build the same way (dev's, for today's clock) and prints both.
// No visible window opens; user data is a temp folder.
import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
/** Each measure must see at least this share of the interval's 60 fps slots as frames, or it can't vouch for them. */
const COVERED_AT_LEAST = 0.95;
/** The positive control must drop at least this share, or the measure can't see a busy GPU. */
const CONTROL_DROPS_AT_LEAST = 0.1;
const CONTROL_BLURS = 64;
/** A stall this long at the start of each round must show as a gap, or the edges of the interval go unmeasured. */
const STALL_MS = 200;
/** The minute's redraw of the clock (its render with the masks rewritten) takes at most this long. */
const REDRAW_MS = 12;
/**
 * The minute's change on the page's main thread (the render, then showing the maps the worker built and the style
 * they cause) takes at most this long, median (#37).
 */
const MINUTE_MEDIAN_MS = 8;
/** Minute changes timed, and minute changes run to look for growth. */
const MINUTES_TIMED = 20;
const MINUTES_GROWTH = 60;
/**
 * The Screen's renderer with the clock shown costs at most this much more than with it hidden: #35's frosted clock
 * cost about 6 MiB, and #37 allows the liquid one 25 MiB over that.
 */
const SHOWN_MIB_AT_MOST = 31;
/**
 * Over a second run of MINUTES_GROWTH minute changes, the renderer's footprint grows at most this much, and its
 * JavaScript heap at most JS_GROWTH_MIB_AT_MOST. The first run fills the renderer's caches (it does for #35's clock
 * too: both level off at about 75 to 85 MiB over a long run of minute changes, #37), so the footprint can still climb
 * a few MiB in the second; the heap shows whether anything the page keeps grows.
 */
const GROWTH_MIB_AT_MOST = 8;
const JS_GROWTH_MIB_AT_MOST = 1;
const APPLE = "/System/Library/Desktop Pictures";
const PICTURES = ["iMac Yellow.heic", "Sonoma.heic"];

app.setPath("userData", mkdtempSync(join(tmpdir(), "clock-frames-check-")));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
// So memory is read after a full collection, not whenever V8 last ran one.
app.commandLine.appendSwitch("js-flags", "--expose-gc");
app.commandLine.appendSwitch("enable-precise-memory-info");
app.dock?.hide();
// Each build's memory is read in a window of its own; closing one mustn't end the run.
app.on("window-all-closed", () => {});

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
  `window.couch = { send() {}, reportGrid() {}, reportGlass() {}, onScreen: (l) => (window.__screen = l), onTint() {}, onSound() {}, onMpv() {} };` +
    // Counts the page's live workers, so a worker left running shows.
    `window.__workers = 0; const W = window.Worker; window.Worker = class extends W { constructor(...a) { super(...a); window.__workers++; } terminate() { window.__workers--; super.terminate(); } };` +
    // Collects the clock's own timings (clock-glass.ts measures each step of a drawing).
    `window.__clockTimes = []; new PerformanceObserver((l) => window.__clockTimes.push(...l.getEntries().map((e) => ({ name: e.name, ms: e.duration })))).observe({ type: "measure" });`,
);

let failed = false;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` ${extra}` : ""}`);
  if (!ok) failed = true;
};

/**
 * In page: times every animation frame from `start()` until `ms` later, and checks `during()` half way through. The
 * interval's own start is returned too (on the page's clock, and as wall time for the composited frames), so a stall
 * before the first frame or after the last counts.
 */
const RECORD = `async (ms, start, during) => {
  const times = [];
  let seen = false;
  let from = 0;
  const done = new Promise((resolve) => {
    const step = (t) => {
      times.push(t);
      if (!seen && t - from > ms / 2) seen = during();
      if (t - from < ms) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  from = performance.now();
  start();
  await done;
  return { times, seen, from, fromWall: performance.timeOrigin + from };
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
  /** The page is held busy, and painting stopped, this long as each round starts: the control for a stall there. */
  stallMs?: number;
}

/** Frame gaps over an interval: frames seen, 60 fps slots covered, slots missed, and the longest gap. */
interface Gaps {
  frames: number;
  slots: number;
  dropped: number;
  longest: number;
}

/**
 * The gaps between the frames in [from, to], counting the one from `from` to the first frame and from the last frame
 * to `to`, so a stall at either end shows.
 */
function gaps(times: number[], from: number, to: number): Gaps {
  const inside = times.filter((t) => t > from && t <= to);
  const points = [from, ...inside, to];
  let dropped = 0;
  let longest = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i]! - points[i - 1]!;
    dropped += Math.max(0, Math.round(dt / SLOT) - 1);
    longest = Math.max(longest, dt);
  }
  return { frames: inside.length, slots: Math.round((to - from) / SLOT), dropped, longest };
}

const sum = (a: Gaps, b: Gaps): Gaps => ({
  frames: a.frames + b.frames,
  slots: a.slots + b.slots,
  dropped: a.dropped + b.dropped,
  longest: Math.max(a.longest, b.longest),
});
const share = (g: Gaps) => g.dropped / Math.max(1, g.slots);
const coverage = (g: Gaps) => g.frames / Math.max(1, g.slots);
const describe = (g: Gaps) =>
  `${g.frames} frames for ${g.slots} slots (${(coverage(g) * 100).toFixed(1)} %), ${g.dropped} dropped (${(share(g) * 100).toFixed(1)} %), longest ${g.longest.toFixed(1)} ms`;

/** When each composited frame reached the main process, as wall time (comparable with the page's). */
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
    composited.push(performance.timeOrigin + performance.now());
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
    const stall = scene.stallMs
      ? `for (const t = performance.now(); performance.now() - t < ${scene.stallMs}; );`
      : "";
    const next = scene.next ? `window.__screen(${JSON.stringify(scene.next(round))});` : "";
    const start = `() => { ${next} ${stall} }`;
    composited.length = 0;
    const recording = win.webContents.executeJavaScript(
      `(${RECORD})(${ROUND_MS}, ${start}, () => ${scene.during})`,
    ) as Promise<{ times: number[]; seen: boolean; from: number; fromWall: number }>;
    if (scene.stallMs) {
      win.webContents.stopPainting();
      await new Promise((r) => setTimeout(r, scene.stallMs));
      win.webContents.startPainting();
    }
    const r = await recording;
    const p = gaps(r.times, r.from, r.from + ROUND_MS);
    const g = gaps(composited, r.fromWall, r.fromWall + ROUND_MS);
    page = page ? sum(page, p) : p;
    gpu = gpu ? sum(gpu, g) : g;
    seen &&= r.seen;
  }
  return { page: page!, gpu: gpu!, seen };
}

/**
 * The minute's change on the page's main thread: the render that changes the time (with its layout, as the next frame
 * would do it), then, once the worker's maps arrive, showing them (the clock's own measure) and the style that causes.
 * Also how long the maps take from the render until they're shown, and a render within the same minute.
 */
async function redraw(win: BrowserWindow, renderer: string, home: Record<string, unknown>) {
  await win.loadFile(join(renderer, "index.html"));
  return (await win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const at = (minute) => ({ ...${JSON.stringify(home)}, now: ${Number(home.now)} + minute * 60000 });
    const lens = () => document.querySelector(".h-clock .cg-lens");
    // The style that showing the maps causes, forced and timed where the clock sets the new filter (its last step).
    let restyle = 0;
    const set = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, ...rest) {
      set.call(this, name, ...rest);
      if (name !== "--cg-refraction") return;
      const t = performance.now();
      void getComputedStyle(lens()).backdropFilter;
      void document.body.offsetHeight;
      restyle = performance.now() - t;
    };
    const shown = async (count) => {
      for (const t = performance.now(); performance.now() - t < 3000; await frame())
        if (window.__clockTimes.filter((e) => e.name === "clock-glass:map").length >= count) return true;
      return false;
    };
    window.__screen(at(0));
    await frame();
    const liquid = !!lens();
    if (liquid) await shown(1);
    const same = [], next = [], minute = [], map = [];
    for (let m = 1; m <= ${MINUTES_TIMED}; m++) {
      let t = performance.now();
      window.__screen({ ...at(m - 1), focusedId: "x" + m });
      void document.body.offsetHeight;
      same.push(performance.now() - t);
      await frame();
      t = performance.now();
      window.__screen(at(m));
      void document.body.offsetHeight;
      const render = performance.now() - t;
      next.push(render);
      if (liquid && !(await shown(m + 1))) return { error: "the maps for minute " + m + " never arrived" };
      const times = (name) => window.__clockTimes.filter((e) => e.name === name);
      minute.push(render + (liquid ? times("clock-glass:show").at(-1).ms + restyle : 0));
      if (liquid) map.push(times("clock-glass:map").at(-1).ms);
      await frame();
    }
    CSSStyleDeclaration.prototype.setProperty = set;
    const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
    return {
      same: median(same),
      next: median(next),
      worst: Math.max(...next),
      minute: median(minute),
      minuteWorst: Math.max(...minute),
      map: median(map),
      mapWorst: map.length ? Math.max(...map) : NaN,
    };
  })()`)) as { error?: string } & Record<
    "same" | "next" | "worst" | "minute" | "minuteWorst" | "map" | "mapWorst",
    number
  >;
}

/** A process's physical footprint in MiB, as macOS counts it (its GPU allocations included). */
function footprint(pid: number): number {
  const file = join(mkdtempSync(join(tmpdir(), "clock-frames-footprint-")), "fp.json");
  execFileSync("/usr/bin/footprint", ["-j", file, "-p", String(pid)], { stdio: "ignore" });
  const json = JSON.parse(readFileSync(file, "utf8")) as { processes: { footprint: number }[] };
  return json.processes[0]!.footprint / 2 ** 20;
}

/**
 * The Screen's renderer memory over a photo with the clock hidden, then shown, then after two runs of MINUTES_GROWTH minute changes
 * (each waiting for its maps), in a window of its own so each build starts from a fresh process. Also how many
 * displacement filters and live workers are left at the end.
 */
async function memory(renderer: string, home: Record<string, unknown>) {
  const win = newWindow();
  await win.loadFile(join(renderer, "index.html"));
  const settle = async () => {
    await win.webContents.executeJavaScript("new Promise((r) => setTimeout(r, 3000))");
    const heap = (await win.webContents.executeJavaScript(
      "gc(); new Promise((r) => setTimeout(r, 1000)).then(() => performance.memory.usedJSHeapSize / 2 ** 20)",
    )) as number;
    return { footprint: footprint(win.webContents.getOSProcessId()), heap };
  };
  await win.webContents.executeJavaScript(
    `document.head.insertAdjacentHTML("beforeend", '<style id="hide-clock">.h-clock{display:none}</style>'); window.__screen(${JSON.stringify(home)}); 0`,
  );
  const hidden = (await settle()).footprint;
  await win.webContents.executeJavaScript(`document.getElementById("hide-clock").remove(); 0`);
  const shown = (await settle()).footprint;
  const minutes = async (from: number) =>
    (await win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const maps = () => window.__clockTimes.filter((e) => e.name === "clock-glass:map").length;
    const liquid = !!document.querySelector(".h-clock .cg-lens");
    for (let m = ${from} + 1; m <= ${from} + ${MINUTES_GROWTH}; m++) {
      const before = maps();
      window.__screen({ ...${JSON.stringify(home)}, now: ${Number(home.now)} + m * 60000 });
      for (const t = performance.now(); liquid && maps() === before && performance.now() - t < 3000; ) await frame();
      await frame();
    }
    await frame();
    window.__clockTimes.length = 0;
    return { filters: document.querySelectorAll(".h-clock .cg-filters filter").length, workers: window.__workers };
  })()`)) as { filters: number; workers: number };
  await minutes(0);
  const once = await settle();
  const left = await minutes(MINUTES_GROWTH);
  const twice = await settle();
  await new Promise<void>((r) => {
    win.once("closed", () => r());
    win.destroy();
  });
  return {
    hidden,
    shown,
    once: once.footprint,
    twice: twice.footprint,
    heapGrowth: twice.heap - once.heap,
    ...left,
  };
}

/** In page: the clock's tint and shadow colours and the photo's dim, as drawn now. */
const LOOK = `(() => {
  const rgba = (c) => (c.match(/[\\d.]+/g) ?? []).map(Number);
  const at = (s) => getComputedStyle(document.querySelector(s));
  return {
    tint: rgba(at(".h-clock .cg-lens").backgroundColor),
    shadow: rgba(at(".h-clock .cg-shadow").backgroundColor),
    dim: [Number(at(".h-photo-dim").opacity)],
  };
})()`;
type Look = Record<"tint" | "shadow" | "dim", number[]>;

/**
 * How far `now` has gone from `from` towards `to`, 0 to 1, over the values that differ between them; NaN if none
 * differs, or if `now` isn't on the way.
 */
function progress(from: number[], to: number[], now: number[]): number {
  const parts = from
    .map((a, i) => [a, to[i]!, now[i]!] as const)
    .filter(([a, b]) => Math.abs(b - a) > 0.02 * Math.max(1, Math.abs(a), Math.abs(b)))
    .map(([a, b, n]) => (n - a) / (b - a));
  if (parts.length === 0 || parts.some((p) => p < -0.02 || p > 1.02)) return Number.NaN;
  return parts.reduce((s, p) => s + p, 0) / parts.length;
}

/**
 * The clock's tint and shadow and the photo's dim follow the slideshow's crossfade: just after the new picture
 * arrives they still match the old one, half way they're between the two, and at the end they match the new one.
 */
async function tintFollowsCrossfade(
  win: BrowserWindow,
  renderer: string,
  from: unknown,
  to: unknown,
): Promise<void> {
  await win.loadFile(join(renderer, "index.html"));
  const wait = (ms: number) =>
    win.webContents.executeJavaScript(`new Promise((r) => setTimeout(r, ${ms}))`);
  const look = async () => (await win.webContents.executeJavaScript(LOOK)) as Look;
  await win.webContents.executeJavaScript(`window.__screen(${JSON.stringify(from)});0`);
  await wait(1500);
  const before = await look();
  // The new picture arrives once it has loaded; time from when its crossfade starts.
  await win.webContents.executeJavaScript(`new Promise((done) => {
    window.__screen(${JSON.stringify(to)});
    const seen = () => (document.querySelector(".h-photo-prev") ? done() : requestAnimationFrame(seen));
    seen();
  })`);
  await wait(100);
  const early = await look();
  await wait(1150);
  const half = await look();
  await wait(2000);
  const after = await look();
  for (const part of ["tint", "shadow", "dim"] as const) {
    const at = (now: Look) => progress(before[part], after[part], now[part]);
    const [e, h, a] = [at(early), at(half), at(after)];
    check(
      `the clock's ${part === "dim" ? "photo dim" : part} follows the crossfade: old at its start, between half way, new at its end`,
      e <= 0.15 && h >= 0.2 && h <= 0.8 && a >= 0.98,
      `(${[e, h, a].map((p) => p.toFixed(2)).join(" → ")}; ${before[part].join(",")} → ${after[part].join(",")})`,
    );
  }
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
    // Memory first, each build in a window (and renderer) of its own.
    for (const [label, renderer] of builds) {
      const m = await memory(renderer, { ...home, home: picture(0) });
      console.log(
        `${label.padEnd(10)} renderer memory: clock hidden ${m.hidden.toFixed(1)} MiB, shown ${m.shown.toFixed(1)} MiB (${(m.shown - m.hidden).toFixed(1)}); after ${MINUTES_GROWTH} minute changes ${m.once.toFixed(1)} MiB, after ${MINUTES_GROWTH} more ${m.twice.toFixed(1)} MiB (${(m.twice - m.once).toFixed(1)}), JS heap ${m.heapGrowth >= 0 ? "+" : ""}${m.heapGrowth.toFixed(2)} MiB; filters left ${m.filters}, workers left ${m.workers}`,
      );
      if (label !== "this build") continue;
      check(
        `the clock shown costs the renderer at most ${SHOWN_MIB_AT_MOST} MiB`,
        m.shown - m.hidden <= SHOWN_MIB_AT_MOST,
        `${(m.shown - m.hidden).toFixed(1)} MiB`,
      );
      check(
        `${MINUTES_GROWTH} more minute changes grow the renderer at most ${GROWTH_MIB_AT_MOST} MiB and its JavaScript heap at most ${JS_GROWTH_MIB_AT_MOST} MiB, and leave one filter and no worker`,
        m.twice - m.once <= GROWTH_MIB_AT_MOST &&
          m.heapGrowth <= JS_GROWTH_MIB_AT_MOST &&
          m.filters === 1 &&
          m.workers === 0,
        `${(m.twice - m.once).toFixed(1)} MiB, JS heap ${m.heapGrowth.toFixed(2)} MiB, ${m.filters} filters, ${m.workers} workers`,
      );
    }
    const win = newWindow();
    await tintFollowsCrossfade(
      win,
      builds.at(-1)![1],
      { ...home, home: picture(0) },
      { ...home, home: picture(1) },
    );
    const heavy = await time(win, builds.at(-1)![1], control);
    console.log(
      `           ${control.name.padEnd(44)} page ${describe(heavy.page)}; composited ${describe(heavy.gpu)}`,
    );
    const stalled: Scene = {
      name: `control: a ${STALL_MS} ms stall as each round starts`,
      setup: idle,
      during: "true",
      stallMs: STALL_MS,
    };
    const stall = await time(win, builds.at(-1)![1], stalled);
    console.log(
      `           ${stalled.name.padEnd(44)} page ${describe(stall.page)}; composited ${describe(stall.gpu)}`,
    );
    check(
      "a stall at the start of a round shows in both measures",
      [stall.page, stall.gpu].every((g) => g.longest >= STALL_MS * 0.8),
      `longest: page ${stall.page.longest.toFixed(1)} ms, composited ${stall.gpu.longest.toFixed(1)} ms`,
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
        check(
          `${scene.name}: frames for at least ${COVERED_AT_LEAST * 100} % of the slots, page and composited`,
          [t.page, t.gpu].every((g) => coverage(g) >= COVERED_AT_LEAST),
        );
      }
    }
    for (const [label, renderer] of builds) {
      const r = await redraw(win, renderer, home);
      if (r.error) throw new Error(`${label}: ${r.error}`);
      console.log(
        `${label.padEnd(10)} a render: same minute ${r.same.toFixed(2)} ms; a new minute ${r.next.toFixed(2)} ms (worst ${r.worst.toFixed(2)} ms)`,
      );
      console.log(
        `${label.padEnd(10)} the minute's change on the main thread ${r.minute.toFixed(2)} ms median (worst ${r.minuteWorst.toFixed(2)} ms); the maps shown ${r.map.toFixed(1)} ms after the render, median (worst ${r.mapWorst.toFixed(1)} ms)`,
      );
      if (label !== "this build") continue;
      check(
        `the minute's redraw of the clock takes at most ${REDRAW_MS} ms`,
        r.worst <= REDRAW_MS,
        `worst ${r.worst.toFixed(2)} ms`,
      );
      check(
        `the minute's change costs the main thread at most ${MINUTE_MEDIAN_MS} ms, median`,
        r.minute <= MINUTE_MEDIAN_MS,
        `median ${r.minute.toFixed(2)} ms`,
      );
      check(`the liquid clock's maps are shown each minute`, Number.isFinite(r.map));
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
