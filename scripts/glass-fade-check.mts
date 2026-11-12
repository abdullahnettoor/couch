// Regression check for #33 and #35: Couch's glass (the question, Setup's panel, Home's clock) stays frosted while it fades in.
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/glass-fade-check.mts
// Needs the built Screen (`vp build`). It draws the REAL Screen (dist/renderer) offscreen over black and white stripes,
// opens the question and Setup's panel from the recorded fixtures, freezes their fade-in at 99 % and measures how
// sharp the stripes are inside the glass box: about 7 is frosted, 20 and more is see-through. Chromium blurs only what is
// inside a see-through parent layer (the plain scrim), so a layer that fades makes the box see-through until the end.
// Home's liquid glass clock (#35, #37) is checked over stripes laid under Home's layers, inside its digits: on Home, as
// the idle clock, and as it comes in after Setup's last step. Its digits are nearly clear, so instead of frost it must
// bend the stripes behind it (its displacement filter live) at 99 % of the fade; the control is the same clock faded
// as a whole, which must stop bending them.
// It also checks the stronger tint the Screen's glass gets over a WebKit App (`body.native-app-front`), where Chromium
// cannot blur the native view and the glass is only its tint. No visible window opens; user data is a temp folder.
import { app, BrowserWindow } from "electron";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GLASS } from "../src/shared/look.ts";
import { decodePng } from "./look-diff.ts";
import { builtCssBlurOffenders } from "./built-css-blur.ts";
import { loadFixtures } from "./look-fixture-data.ts";

const SIZE = { width: 1280, height: 720 };
/** Contrast across the box: frosted reads about 7 to 8, a see-through layer 23 and more at 99 %. */
const FROSTED_BELOW = 14;
/** The positive control (an unblurred box) must read at least this, and the frosted limit is also held under a third of it. */
const CONTROL_ABOVE = 30;
/** Readings of the same frame must agree within this. */
const TOLERANCE = 2;
const READINGS = 3;
const ATTEMPTS = 20;
/** How many frames to wait for a state (a fade to start, a frame to carry a change) before giving up. */
const FRAMES = 300;
const STRIPES = "repeating-linear-gradient(90deg,#fff 0 4px,#000 4px 8px)";

app.setPath("userData", mkdtempSync(join(tmpdir(), "glass-fade-check-")));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.dock?.hide();

const scratch = mkdtempSync(join(tmpdir(), "glass-fade-preload-"));
mkdirSync(scratch, { recursive: true });
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

const frame = (win: BrowserWindow) =>
  win.webContents.executeJavaScript(
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
  );

type Rect = { x: number; y: number; w: number; h: number };
/** A row of pixels to read: `width` pixels from (x, y). */
type Row = { x: number; y: number; width: number };

/**
 * Holds every running transition and animation of the page at `progress` of its run (an infinite one, like the idle
 * clock's drift, is paused where it is), so nothing moves or fades while it is read. Returns how many of them fade
 * opacity (an opacity transition, or a CSS animation that changes opacity). In page.
 */
const FREEZE = `(progress) => {
  let fades = 0;
  for (const a of document.getAnimations()) {
    const t = a.effect.getComputedTiming();
    a.pause();
    if (!Number.isFinite(t.activeDuration)) continue;
    if (a.transitionProperty === "opacity" || (a.animationName && a.effect.getKeyframes().some((k) => "opacity" in k))) fades++;
    a.effect.updateTiming({ easing: "linear" });
    if (a.animationName) a.effect.setKeyframes(a.effect.getKeyframes().map(({ computedOffset, easing, ...k }) => k));
    a.currentTime = (t.delay || 0) + progress * t.activeDuration;
  }
  return fades;
}`;

/**
 * Waits for a known state, not a time: freezes the fades in the task that finds them (a fade is created by the style
 * update that follows the change, before it has run a frame, so a slow runner cannot let it finish first), looks again
 * a frame later for any that start late, and gives up only after FRAMES frames with none. In page; ready() says
 * the thing under test is on the page.
 */
const FREEZE_WHEN_RUNNING = `async (progress, ready) => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  let fades = 0;
  for (let i = 0; i < ${FRAMES} && !fades; i++) {
    if (ready()) fades = (${FREEZE})(progress);
    if (!fades) await frame();
  }
  await frame();
  return ready() ? (${FREEZE})(progress) : 0;
}`;

/** Opens `payload` on the real Screen over stripes, freezes every running transition and animation at `progress`, and returns the box's rectangle. */
async function open(
  win: BrowserWindow,
  payload: unknown,
  box: string,
  progress: number,
  inScreen = false,
) {
  await win.loadFile(join(import.meta.dirname, "../dist/renderer/index.html"));
  const info = await win.webContents.executeJavaScript(`(async () => {
    ${inScreen ? "" : 'document.getElementById("screen").style.display = "none";'}
    const stripes = document.createElement("div");
    stripes.style.cssText = "position:fixed;inset:0;z-index:1;background:" + ${JSON.stringify(STRIPES)};
    document.body.prepend(stripes);
    window.__screen(${JSON.stringify(payload)});
    const fades = await (${FREEZE_WHEN_RUNNING})(${progress}, () => !!document.querySelector(${JSON.stringify(box)}));
    const box = document.querySelector(${JSON.stringify(box)});
    if (!box) return { error: "no ${box}" };
    const rect = box.getBoundingClientRect();
    const layers = [];
    for (let e = box.parentElement; e; e = e.parentElement) layers.push(getComputedStyle(e).opacity);
    return { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, fades, layers, boxOpacity: getComputedStyle(box).opacity };
  })()`);
  if (info.error) throw new Error(info.error);
  await frame(win);
  return info as { rect: Rect; fades: number; layers: string[]; boxOpacity: string };
}

/** A 40-pixel row just inside a box's top edge, clear of its text. */
const topRow = (rect: Rect): Row => ({ x: rect.x + rect.w / 2 - 20, y: rect.y + 6, width: 40 });

let epoch = 0;
/**
 * The spread of grey values along a row of pixels, read from a frame known to carry the page as it is now. Two marker
 * lines, one just above and one just below the row, are given a colour no earlier frame had, and the capture is
 * repeated until both show it; the row is read from that same capture. The markers sit in the row's own tile because
 * Chromium rasterises a changed area tile by tile, and under load can hand back a frame with a corner updated and the
 * rest still the old picture (a marker in the corner is not enough). They lie over the glass, not under it, so they are
 * not in what it blurs.
 */
async function contrast(win: BrowserWindow, row: Row) {
  const x = Math.round(row.x);
  const y = Math.round(row.y);
  const width = Math.round(row.width);
  const mark = (epoch++ % 250) + 3;
  await win.webContents.executeJavaScript(`(() => {
    for (const [id, top] of [["above", ${y - 2}], ["below", ${y + 2}]]) {
      let m = document.getElementById("glass-frame-mark-" + id);
      if (!m) {
        m = document.createElement("i");
        m.id = "glass-frame-mark-" + id;
        document.body.append(m);
      }
      m.style.cssText = "position:fixed;height:1px;z-index:2147483647;pointer-events:none;left:${x}px;top:" + top + "px;width:${width}px;background:rgb(${mark},${mark},${mark})";
    }
  })()`);
  for (let tries = 0; tries < FRAMES; tries++) {
    const painted = new Promise<void>((r) => win.webContents.once("paint", () => r()));
    win.webContents.invalidate();
    await painted;
    const { data, width: imageWidth } = decodePng((await win.webContents.capturePage()).toPNG());
    const at = (px: number, py: number) => data[(py * imageWidth + px) * 4];
    const marked = (py: number) =>
      [x, x + width - 1].every((px) => Math.abs(at(px, py) - mark) <= 1);
    if (!marked(y - 2) || !marked(y + 2)) continue;
    const grey: number[] = [];
    for (let i = 0; i < width; i++) grey.push(at(x + i, y));
    return Math.max(...grey) - Math.min(...grey);
  }
  throw new Error(`no frame carried the page's current state (${FRAMES} captures)`);
}

/**
 * Takes readings of the same spot until the last READINGS agree (at most ATTEMPTS), and fails the run if they never do.
 * A reading can still be of a frame that is partly the old picture (a layer that changed is redrawn on its own
 * schedule, which the markers in contrast() cannot see), so the answer is the value the readings settle on, not the
 * first one. A genuinely flickering result never settles and fails.
 */
async function steady(label: string, win: BrowserWindow, row: Row) {
  const reads: number[] = [];
  let window: number[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    reads.push(await contrast(win, row));
    window = reads.slice(-READINGS);
    if (window.length === READINGS && Math.max(...window) - Math.min(...window) <= TOLERANCE) break;
  }
  const spread = Math.max(...window) - Math.min(...window);
  check(
    `${label}: ${READINGS} readings agree`,
    window.length === READINGS && spread <= TOLERANCE,
    `readings=${reads.join(",")}`,
  );
  return Math.max(...window);
}

let shared: BrowserWindow | undefined;
function newWindow() {
  if (shared) return shared;
  const win = new BrowserWindow({
    ...SIZE,
    show: false,
    useContentSize: true,
    frame: false,
    backgroundColor: "#000000",
    webPreferences: {
      offscreen: true,
      preload,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setFrameRate(30);
  shared = win;
  return win;
}

async function addStyle(win: BrowserWindow, id: string, css: string) {
  await win.webContents.executeJavaScript(`(() => {
    document.getElementById(${JSON.stringify(id)})?.remove();
    const style = document.createElement("style");
    style.id = ${JSON.stringify(id)};
    style.textContent = ${JSON.stringify(css)};
    document.head.append(style);
  })()`);
  await frame(win);
}

/**
 * A scrim that frosts the page behind it (#43): its row of stripes, clear of the box, must be blurred at 99 % of its fade
 * (the blur fades with the scrim, never snapping on at the end), and the same scrim without its backdrop-filter is the
 * positive control. Its layer must stay opaque, as the box's must.
 */
async function measureScrim(label: string, payload: unknown, scrim: string) {
  const win = newWindow();
  const half = await open(win, payload, ".support-box", 0.5, true);
  check(
    `${label}: its scrim fades in with the box (two animations at 50 %)`,
    half.fades >= 2,
    `animations=${half.fades}`,
  );
  const late = await open(win, payload, ".support-box", 0.99, true);
  const row = { x: 60, y: 8, width: 40 };
  const c = await steady(`${label}'s scrim`, win, row);
  await addStyle(win, "scrim-off", `${scrim} { backdrop-filter: none !important; }`);
  const control = await steady(`${label}'s scrim (positive control, unblurred)`, win, row);
  await win.webContents.executeJavaScript(`document.getElementById("scrim-off").remove()`);
  check(
    `${label}'s scrim: an unblurred scrim reads clearly striped`,
    control >= 20,
    `control contrast=${control}`,
  );
  check(
    `${label}'s scrim frosts the page at 99 % of its fade`,
    c < Math.min(FROSTED_BELOW, control / 3),
    `stripe contrast=${c}, control=${control}, box at ${Math.round(late.rect.x)}`,
  );
}

/** `inScreen`: the box lives inside #screen (the Support panel), so the Screen stays shown with the stripes under it. */
async function measure(
  label: string,
  payload: unknown,
  box: string,
  inScreen = false,
  controlAbove = CONTROL_ABOVE,
  scrimOff = "",
) {
  const win = newWindow();
  const half = await open(win, payload, box, 0.5, inScreen);
  check(
    `${label} fades in (something is mid-fade at 50 %)`,
    half.fades > 0,
    `animations=${half.fades}`,
  );
  const own = Number(half.boxOpacity);
  check(
    `${label}: the box itself is mid-fade at 50 % (own opacity about 0.5)`,
    Math.abs(own - 0.5) <= 0.1,
    `box opacity=${half.boxOpacity}`,
  );
  check(
    `${label}: no layer around the box is see-through while it fades`,
    half.layers.every((o) => o === "1"),
    `ancestor opacities=${half.layers.join(",")}`,
  );
  const late = await open(win, payload, box, 0.99, inScreen);
  // A frosted scrim blurs the stripes under the box too, so the box is read with the scrim's own blur taken away.
  if (scrimOff) await addStyle(win, "scrim-off", scrimOff);
  const c = await steady(label, win, topRow(late.rect));
  await win.webContents.executeJavaScript(`(() => {
    const control = document.createElement("div");
    control.id = "glass-control";
    document.querySelector(${JSON.stringify(box)}).style.visibility = "hidden";
    control.style.cssText = "position:fixed;z-index:99999;background:rgba(36,36,40,0.72);left:${late.rect.x}px;top:${late.rect.y}px;width:${late.rect.w}px;height:${late.rect.h}px";
    document.body.append(control);
  })()`);
  await frame(win);
  const control = await steady(`${label} (positive control, unblurred)`, win, topRow(late.rect));
  if (process.env.OUT) {
    const shot = await win.webContents.capturePage();
    writeFileSync(join(process.env.OUT, `${label.replace(/\W+/g, "-")}-control.png`), shot.toPNG());
  }
  await win.webContents.executeJavaScript(
    `document.getElementById("glass-control").remove(); document.querySelector(${JSON.stringify(box)}).style.visibility = ""`,
  );
  check(
    `${label}: an unblurred box reads clearly see-through`,
    control >= controlAbove,
    `control contrast=${control}`,
  );
  const limit = Math.min(FROSTED_BELOW, control / 3);
  if (process.env.OUT) {
    const shot = await win.webContents.capturePage();
    writeFileSync(join(process.env.OUT, `${label.replace(/\W+/g, "-")}.png`), shot.toPNG());
  }
  check(
    `${label} is frosted at 99 % of its fade`,
    c < limit,
    `stripe contrast=${c}, limit=${limit.toFixed(1)}`,
  );
}

/**
 * Opens Home on the real Screen with stripes laid under its layers, shows `before` and then `after` (so the clock fades
 * in), waits for the liquid clock's maps (built in a worker), and freezes the fade at `progress`. `farewell` marks the
 * page as Setup's last step closing. Returns the lens's opacity, the opacities of every layer around it, its box, and
 * its mask (the digits) drawn at that box's size.
 */
async function openClock(
  win: BrowserWindow,
  steps: { before?: unknown; after: unknown; farewell?: boolean },
  progress: number,
) {
  await win.loadFile(join(import.meta.dirname, "../dist/renderer/index.html"));
  const info = await win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const stripes = document.createElement("div");
    stripes.style.cssText = "position:absolute;inset:0;background:" + ${JSON.stringify(STRIPES)};
    const lay = () => document.querySelector(".home")?.firstElementChild !== stripes && document.querySelector(".home")?.prepend(stripes);
    ${steps.farewell ? 'document.body.classList.add("setup-farewell");' : ""}
    ${steps.before ? `window.__screen(${JSON.stringify(steps.before)}); lay(); await frame();` : ""}
    window.__screen(${JSON.stringify(steps.after)});
    lay();
    // The fade is held from the start, so it can't finish while the worker builds the maps.
    let fades = await (${FREEZE_WHEN_RUNNING})(${progress}, () => !!document.querySelector(".h-clock .cg-lens"));
    await frame();
    const lens = document.querySelector(".h-clock .cg-lens");
    if (!lens) return { error: "no liquid glass clock (.h-clock .cg-lens)" };
    for (const t = performance.now(); !lens.style.getPropertyValue("--cg-refraction"); await frame())
      if (performance.now() - t > 5000) return { error: "the liquid clock's maps never arrived" };
    if (!document.querySelector(".h-clock .t.cg-drawn")) return { error: "the clock's glass was not drawn" };
    // Hold anything that started since at the same point, and everything else still (the clock rising after Setup, the
    // idle drift), so readings of the bend agree.
    fades = Math.max(fades, (${FREEZE})(${progress}));
    const layers = [];
    for (let e = lens.parentElement; e; e = e.parentElement) layers.push(getComputedStyle(e).opacity);
    const r = lens.getBoundingClientRect();
    const rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    const mask = new Image();
    mask.src = /url\\("?([^")]+)"?\\)/.exec(getComputedStyle(lens).maskImage)[1];
    await mask.decode();
    const c = document.createElement("canvas");
    c.width = rect.w;
    c.height = rect.h;
    c.getContext("2d").drawImage(mask, 0, 0, rect.w, rect.h);
    return { fades, layers, own: getComputedStyle(lens).opacity, rect, mask: c.toDataURL("image/png") };
  })()`);
  if (info.error) throw new Error(info.error);
  await frame(win);
  return info as { fades: number; layers: string[]; own: string; rect: Rect; mask: string };
}

/** The grey values of a box, as painted now. */
async function grab(win: BrowserWindow, rect: Rect): Promise<number[]> {
  const painted = new Promise<void>((r) => win.webContents.once("paint", () => r()));
  win.webContents.invalidate();
  await painted;
  const image = await win.webContents.capturePage({
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
  });
  const { data, width, height } = decodePng(image.toPNG());
  const grey: number[] = [];
  for (let i = 0; i < width * height; i++) grey.push(data[i * 4]);
  return grey;
}

/**
 * How much the lens bends the stripes behind it, inside the digits: the mean grey difference between the lens as drawn
 * and the same lens with its displacement filter taken away (only the lift left). A see-through parent turns a
 * backdrop-filter off (#33), and then the two are the same.
 */
async function bend(win: BrowserWindow, rect: Rect, inside: boolean[]): Promise<number> {
  const live = await grab(win, rect);
  await win.webContents.executeJavaScript(
    `document.querySelector(".h-clock .cg-lens").style.backdropFilter = "var(--blur-clock-glass-lift)"`,
  );
  await frame(win);
  const flat = await grab(win, rect);
  await win.webContents.executeJavaScript(
    `document.querySelector(".h-clock .cg-lens").style.backdropFilter = ""`,
  );
  await frame(win);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < inside.length; i++)
    if (inside[i]) {
      sum += Math.abs(live[i]! - flat[i]!);
      n++;
    }
  return n ? sum / n : 0;
}

/** Three readings of the bend; fails the run if they disagree. */
async function steadyBend(label: string, win: BrowserWindow, rect: Rect, inside: boolean[]) {
  const reads: number[] = [];
  for (let i = 0; i < READINGS; i++) reads.push(await bend(win, rect, inside));
  const spread = Math.max(...reads) - Math.min(...reads);
  check(
    `${label}: ${READINGS} readings agree`,
    spread <= TOLERANCE,
    `readings=${reads.map((r) => r.toFixed(1)).join(",")}`,
  );
  return Math.min(...reads);
}

/** The liquid clock bends the picture behind it this much at least (mean grey levels inside the digits), and the
 * same clock under a see-through parent (the old whole-clock fade) at most a third of that. */
const BENDS_ABOVE = 6;

async function measureClock(
  label: string,
  steps: { before?: unknown; after: unknown; farewell?: boolean },
) {
  const win = newWindow();
  const half = await openClock(win, steps, 0.5);
  check(`${label} fades in (something is mid-fade at 50 %)`, half.fades > 0, `fades=${half.fades}`);
  check(
    `${label}: the glass itself is mid-fade at 50 % (own opacity about 0.5)`,
    Math.abs(Number(half.own) - 0.5) <= 0.1,
    `glass opacity=${half.own}`,
  );
  check(
    `${label}: no layer around the glass is see-through while it fades`,
    half.layers.every((o) => o === "1"),
    `ancestor opacities=${half.layers.join(",")}`,
  );
  const late = await openClock(win, steps, 0.99);
  const mask = decodePng(Buffer.from(late.mask.split(",")[1]!, "base64"));
  const inside = Array.from(
    { length: mask.width * mask.height },
    (_, i) => mask.data[i * 4 + 3]! > 128,
  );
  check(
    `${label}: the digits to read inside`,
    inside.filter(Boolean).length > 1000,
    `pixels=${inside.filter(Boolean).length}`,
  );
  const live = await steadyBend(label, win, late.rect, inside);
  if (process.env.OUT) {
    const shot = await win.webContents.capturePage();
    writeFileSync(join(process.env.OUT, `${label.replace(/\W+/g, "-")}.png`), shot.toPNG());
  }
  // The negative control: the same clock faded as a whole, as before #35. Its lens must stop bending the stripes.
  await win.webContents.executeJavaScript(
    `document.querySelector(".h-clock").style.opacity = "0.99"`,
  );
  await frame(win);
  const faded = await steadyBend(
    `${label} (control: the whole clock fading)`,
    win,
    late.rect,
    inside,
  );
  await win.webContents.executeJavaScript(`document.querySelector(".h-clock").style.opacity = ""`);
  check(
    `${label}: a clock fading as a whole stops bending the picture, so the reading can tell`,
    faded < BENDS_ABOVE / 3,
    `bend=${faded.toFixed(1)}`,
  );
  check(
    `${label} bends the picture behind it at 99 % of its fade`,
    live >= BENDS_ABOVE && live >= faded * 3,
    `bend=${live.toFixed(1)}, limit=${BENDS_ABOVE} and 3 × ${faded.toFixed(1)}`,
  );
}

/** The tint the question, the toast and the volume display take, with and without a WebKit App in front. */
async function tints() {
  const win = newWindow();
  {
    await win.loadFile(join(import.meta.dirname, "../dist/renderer/index.html"));
    const read = (native: boolean) =>
      win.webContents.executeJavaScript(`(() => {
        document.head.insertAdjacentHTML("beforeend", "<style>*{transition:none!important}</style>");
        document.body.classList.toggle("native-app-front", ${native});
        document.getElementById("confirm").innerHTML = '<div class="box glass"></div>';
        const bg = (s) => getComputedStyle(document.querySelector(s)).backgroundColor;
        return { toast: bg("#toast"), volume: bg("#volume"), box: bg("#confirm .box") };
      })()`);
    const normal = await read(false);
    const over = await read(true);
    const want = (await win.webContents.executeJavaScript(
      `(() => { const e = document.createElement("i"); e.style.background = ${JSON.stringify(GLASS.color.glassOverWebApp)}; document.body.append(e); return getComputedStyle(e).backgroundColor; })()`,
    )) as string;
    for (const part of ["toast", "volume", "box"] as const) {
      check(
        `${part} takes the stronger tint over a WebKit App`,
        over[part] === want,
        `${over[part]}`,
      );
      check(`${part} is unchanged otherwise`, normal[part] !== want, `${normal[part]}`);
    }
  }
}

void app.whenReady().then(async () => {
  try {
    const offenders = builtCssBlurOffenders(join(import.meta.dirname, "../dist/renderer"));
    check(
      "every built rule that blurs keeps the unprefixed backdrop-filter (#36)",
      offenders.length === 0,
      offenders.join(", "),
    );
    const { screen } = loadFixtures();
    await measure("the question", screen["overlay-confirm"], ".confirm .box");
    await measure(
      "Setup's panel",
      { ...screen["overlay-setup"], setup: { ...screen["overlay-setup"].setup, intro: false } },
      "#setup .box",
    );
    await measure(
      "the Support Couch panel",
      screen["settings-about-support"],
      ".support-box",
      true,
      // The page's scrim dims the stripes under the box, so the unblurred control reads a little lower.
      20,
      ".support-panel::before { backdrop-filter: none !important; }",
    );
    await measureScrim(
      "the Support Couch panel",
      screen["settings-about-support"],
      ".support-panel::before",
    );
    const home = screen.home;
    const hero = screen["home-hero"];
    await measureClock("Home's clock", { before: hero, after: home });
    await measureClock("the idle clock", {
      before: { ...hero, ambient: true },
      after: screen["home-ambient"],
    });
    await measureClock("the clock after Setup", { after: home, farewell: true });
    await tints();
  } catch (error) {
    console.error(
      `FAIL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    failed = true;
  }
  app.exit(failed ? 1 : 0);
});
