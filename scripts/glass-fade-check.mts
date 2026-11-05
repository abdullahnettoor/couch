// Regression check for #33: Couch's glass panels (the question, Setup's panel) stay frosted while they fade in.
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/glass-fade-check.mts
// Needs the built Screen (`vp build`). It draws the REAL Screen (dist/renderer) offscreen over black and white stripes,
// opens the question and Setup's panel from the recorded fixtures, freezes their fade-in at 99 % and measures how
// sharp the stripes are inside the glass box: about 7 is frosted, 20 and more is see-through. Chromium blurs only what is
// inside a see-through parent layer (the plain scrim), so a layer that fades makes the box see-through until the end.
// It also checks the stronger tint the Screen's glass gets over a WebKit App (`body.native-app-front`), where Chromium
// cannot blur the native view and the glass is only its tint. No visible window opens; user data is a temp folder.
import { app, BrowserWindow } from "electron";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GLASS } from "../src/shared/look.ts";
import { decodePng } from "./look-diff.ts";
import { loadFixtures } from "./look-fixture-data.ts";

const SIZE = { width: 1280, height: 720 };
/** Contrast across the box: frosted reads about 7 to 8, a see-through layer 23 and more at 99 %. */
const FROSTED_BELOW = 14;
/** The positive control (an unblurred box) must read at least this, and the frosted limit is also held under a third of it. */
const CONTROL_ABOVE = 30;
/** Readings of the same frame must agree within this. */
const TOLERANCE = 2;
const READINGS = 3;
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

/** Opens `payload` on the real Screen over stripes, freezes every running transition and animation at `progress`, and returns the box's rectangle. */
async function open(win: BrowserWindow, payload: unknown, box: string, progress: number) {
  await win.loadFile(join(import.meta.dirname, "../dist/renderer/index.html"));
  const info = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById("screen").style.display = "none";
    const stripes = document.createElement("div");
    stripes.style.cssText = "position:fixed;inset:0;z-index:1;background:" + ${JSON.stringify(STRIPES)};
    document.body.prepend(stripes);
    window.__screen(${JSON.stringify(payload)});
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = document.querySelector(${JSON.stringify(box)});
    if (!box) return { error: "no ${box}" };
    const fades = document.getAnimations().filter((a) => a.transitionProperty === "opacity" || a.animationName);
    for (const a of fades) {
      a.pause();
      a.effect.updateTiming({ easing: "linear" });
      a.currentTime = ${progress} * (a.effect.getComputedTiming().endTime || 0);
    }
    const rect = box.getBoundingClientRect();
    const layers = [];
    for (let e = box.parentElement; e; e = e.parentElement) layers.push(getComputedStyle(e).opacity);
    return { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, fades: fades.length, layers, boxOpacity: getComputedStyle(box).opacity };
  })()`);
  if (info.error) throw new Error(info.error);
  await frame(win);
  return info as {
    rect: { x: number; y: number; w: number; h: number };
    fades: number;
    layers: string[];
    boxOpacity: string;
  };
}

/** The spread of grey values along a 40-pixel row just inside the box's top edge, clear of its text. */
async function contrast(win: BrowserWindow, rect: { x: number; y: number; w: number; h: number }) {
  const painted = new Promise<void>((r) => win.webContents.once("paint", () => r()));
  win.webContents.invalidate();
  await painted;
  const image = await win.webContents.capturePage({
    x: Math.round(rect.x + rect.w / 2 - 20),
    y: Math.round(rect.y + 6),
    width: 40,
    height: 1,
  });
  const { data, width } = decodePng(image.toPNG());
  const grey: number[] = [];
  for (let i = 0; i < width; i++) grey.push(data[i * 4]);
  return Math.max(...grey) - Math.min(...grey);
}

/** Three readings of the same spot; fails the run if they disagree. */
async function steady(
  label: string,
  win: BrowserWindow,
  rect: { x: number; y: number; w: number; h: number },
) {
  const reads: number[] = [];
  for (let i = 0; i < READINGS; i++) reads.push(await contrast(win, rect));
  const spread = Math.max(...reads) - Math.min(...reads);
  check(`${label}: ${READINGS} readings agree`, spread <= TOLERANCE, `readings=${reads.join(",")}`);
  return Math.max(...reads);
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

async function measure(label: string, payload: unknown, box: string) {
  const win = newWindow();
  const half = await open(win, payload, box, 0.5);
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
  const late = await open(win, payload, box, 0.99);
  const c = await steady(label, win, late.rect);
  await win.webContents.executeJavaScript(`(() => {
    const control = document.createElement("div");
    control.id = "glass-control";
    document.querySelector(${JSON.stringify(box)}).style.visibility = "hidden";
    control.style.cssText = "position:fixed;z-index:99999;background:rgba(36,36,40,0.72);left:${late.rect.x}px;top:${late.rect.y}px;width:${late.rect.w}px;height:${late.rect.h}px";
    document.body.append(control);
  })()`);
  await frame(win);
  const control = await steady(`${label} (positive control, unblurred)`, win, late.rect);
  if (process.env.OUT) {
    const shot = await win.webContents.capturePage();
    writeFileSync(join(process.env.OUT, `${label.replace(/\W+/g, "-")}-control.png`), shot.toPNG());
  }
  await win.webContents.executeJavaScript(
    `document.getElementById("glass-control").remove(); document.querySelector(${JSON.stringify(box)}).style.visibility = ""`,
  );
  check(
    `${label}: an unblurred box reads clearly see-through`,
    control >= CONTROL_ABOVE,
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
    const { screen } = loadFixtures();
    await measure("the question", screen["overlay-confirm"], ".confirm .box");
    await measure(
      "Setup's panel",
      { ...screen["overlay-setup"], setup: { ...screen["overlay-setup"].setup, intro: false } },
      "#setup .box",
    );
    await tints();
  } catch (error) {
    console.error(
      `FAIL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    failed = true;
  }
  app.exit(failed ? 1 : 0);
});
