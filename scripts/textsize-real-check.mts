// The real-Electron check of Text size's zoom isolation (#58), run by hand: pnpm textsize:check. Not in CI.
// Phase "save" (first Electron start): a plain default-mode page on origin A gets zoom 2.5, which Chromium saves per origin in the partition.
// Phase "check" (a restart on the same temp userData): Couch's real ElectronWebApp host, with a textSize description and
// without one, loads origin A in that partition, and the table below is printed. Offscreen (a window that is never shown),
// a temp userData, local pages on two non-default ports. Origin A is 127.0.0.1:47811; origin B (another host name, as Chromium
// keys zoom by host name) is localhost:47812.
import { app, BrowserWindow, session, webContents, type WebContents } from "electron";
import { createServer, type Server } from "node:http";
import { netflixDescription } from "../src/main/apps/netflix/netflix-web.ts";
import { ElectronWebApp } from "../src/main/web/electron-web-app.ts";
import type { WebAppDescription } from "../src/main/web/web-app.ts";
import { hiddenWindow } from "./lib/hidden-window.mts";

const PHASE = process.env.COUCH_TEXTSIZE_PHASE;
const USER_DATA = process.env.COUCH_TEXTSIZE_USER_DATA;
if (!USER_DATA || (PHASE !== "save" && PHASE !== "check"))
  throw new Error("run through pnpm textsize:check");
app.setPath("userData", USER_DATA);
app.commandLine.appendSwitch("mute-audio");
// As Couch does (src/main/index.ts): never the Mac's Now Playing app, so a headset's pause (or one dropping out) can't stop the check.
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling,MediaSessionService");
app.dock?.hide();

const PORT_A = 47811;
const PORT_B = 47812;
const ORIGIN_A = `http://127.0.0.1:${PORT_A}`;
const ORIGIN_B = `http://localhost:${PORT_B}`;
const PARTITION = "persist:textsize-check";
const SAVED = 2.5;
const WIDTH = 1920;
const TARGET = 1280;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The page records how wide it is at the moments a wrong zoom would show: while its head runs (before anything is painted),
// at DOMContentLoaded and in the first two animation frames (an offscreen window runs no frames, so only the first two are measured).
const PAGE = (name: string) => `<!doctype html><meta charset=utf-8><title>${name}</title>
<script>window.__s=[{at:'head',w:innerWidth}];
addEventListener('DOMContentLoaded',()=>__s.push({at:'dcl',w:innerWidth}));
requestAnimationFrame(()=>{__s.push({at:'raf1',w:innerWidth});requestAnimationFrame(()=>__s.push({at:'raf2',w:innerWidth}))});</script>
<body style="margin:0;background:#123">${name}</body>`;
const serve = (port: number, name: string) =>
  new Promise<Server>((resolve) => {
    const s = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(PAGE(name));
    });
    s.listen(port, "127.0.0.1", () => resolve(s));
  });

/** A page in the partition with no Couch host (default zoom mode, as any ordinary page). */
function plainPage(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    x: -10000,
    y: -10000,
    width: 400,
    height: 300,
    webPreferences: { session: session.fromPartition(PARTITION) },
  });
}

async function waitFor(what: string, test: () => boolean | Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(50);
  }
  throw new Error(`timed out: ${what}`);
}

void app.whenReady().then(async () => {
  const servers = [await serve(PORT_A, "A"), await serve(PORT_B, "B")];
  let code = 0;
  try {
    if (PHASE === "save") {
      const page = plainPage();
      await page.loadURL(ORIGIN_A + "/");
      page.webContents.setZoomFactor(SAVED);
      await sleep(1000);
      console.log(`[textsize-check] saved default-mode zoom ${SAVED} for ${ORIGIN_A}`);
      session.fromPartition(PARTITION).flushStorageData();
      page.destroy();
    } else {
      code = await check();
    }
  } catch (e) {
    console.error("[textsize-check] error:", e);
    code = 1;
  }
  servers.forEach((s) => s.close());
  app.exit(code);
});

async function check(): Promise<number> {
  const rows: Array<[boolean, string, string]> = [];
  const note = (ok: boolean, what: string, detail: string) => rows.push([ok, what, detail]);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  // A window that is never shown; the host only asks to reveal it when it is not "focused and visible", so say it is.
  const win = new BrowserWindow({
    show: false,
    x: -10000,
    y: -10000,
    width: WIDTH,
    height: 1080,
    useContentSize: true,
  });
  const hidden = hiddenWindow(win);
  const width = win.getContentBounds().width;
  const expected = Math.max(1, width / TARGET); // Default size: no multiplier
  const base = {
    ...netflixDescription("130.0.0.0"),
    url: ORIGIN_A + "/",
    partition: PARTITION,
    isOwnOrigin: () => true,
    drm: false,
  } satisfies WebAppDescription;
  const withSize: WebAppDescription = { ...base, textSize: { targetWidth: TARGET } };
  // Netflix opts in itself (#62): the host without textSize is Netflix's description with it taken out.
  const without: WebAppDescription = { ...base };
  delete without.textSize;

  const ids = () => new Set(webContents.getAllWebContents().map((c) => c.id));
  const newContents = (before: Set<number>): WebContents =>
    webContents.getAllWebContents().find((c) => !before.has(c.id))!;
  const loaded = (wc: WebContents, url: string) =>
    waitFor(`${url} loaded`, () => wc.getURL().startsWith(url) && !wc.isLoading());
  const samples = (wc: WebContents) =>
    wc.executeJavaScript("window.__s") as Promise<Array<{ at: string; w: number }>>;

  // The saved zoom survived the restart: an ordinary page on A starts at it.
  const plain = plainPage();
  await plain.loadURL(ORIGIN_A + "/");
  note(
    near(plain.webContents.getZoomFactor(), SAVED),
    "precondition: default-mode zoom saved for A survived the restart",
    `plain page on A: ${plain.webContents.getZoomFactor()}`,
  );

  // Host with textSize.
  let before = ids();
  const opt = new ElectronWebApp(withSize, hidden as BrowserWindow);
  let optWc = newContents(before);
  opt.show();
  await loaded(optWc, ORIGIN_A);
  note(
    near(optWc.getZoomFactor(), expected),
    "opt-in host gets the formula's zoom",
    `${optWc.getZoomFactor()} (window ${width} pt / target ${TARGET})`,
  );
  note(
    near(plain.webContents.getZoomFactor(), SAVED),
    "...and the saved default-mode zoom is not touched (isolated)",
    `plain page on A: ${plain.webContents.getZoomFactor()}`,
  );

  // First committed paint: the first sample at each moment must already be at the zoom (innerWidth * zoom = view width).
  const s = await samples(optWc);
  const wrong = s.filter((x) => Math.abs(x.w * expected - width) > 2);
  note(
    wrong.length === 0,
    "first paint is not at a wrong zoom (innerWidth at head, DOMContentLoaded)",
    s.map((x) => `${x.at}=${x.w}`).join(" "),
  );

  // Overlays on screen when the zoom changes keep their on-screen size (the search bar is 1000 pt wide, the volume pill 380 pt tall, at a 1920 x 1080 window).
  const onScreen = (id: string, dim: "width" | "height") =>
    optWc.executeJavaScript(
      `(()=>{const e=document.getElementById(${JSON.stringify(id)});return e?e.getBoundingClientRect().${dim}*${optWc.getZoomFactor()}:-1})()`,
    ) as Promise<number>;
  opt.showSearchBar("abc");
  opt.showVolume(40);
  const sizes: string[] = [];
  let kept = true;
  for (const size of ["default", "larger", "smaller", "default"] as const) {
    opt.setTextSize(size);
    await sleep(300);
    const [bar, pill] = [
      await onScreen("couch-search", "width"),
      await onScreen("couch-volume", "height"),
    ];
    sizes.push(
      `${size}: zoom ${optWc.getZoomFactor().toFixed(3)} bar ${bar.toFixed(1)} pill ${pill.toFixed(1)}`,
    );
    kept &&= Math.abs(bar - 1000) < 2 && Math.abs(pill - 380) < 2;
  }
  note(
    kept,
    "open search bar and volume pill keep their on-screen size across Text size changes",
    sizes.join("; "),
  );
  opt.showSearchBar(undefined);
  opt.showVolume(undefined);

  // Host without textSize on the same origin and partition.
  before = ids();
  const plainHost = new ElectronWebApp(without, hidden as BrowserWindow);
  const plainHostWc = newContents(before);
  plainHost.show();
  await loaded(plainHostWc, ORIGIN_A);
  note(
    near(plainHostWc.getZoomFactor(), 1),
    "non-opt-in Couch host on the same origin stays at 1",
    `${plainHostWc.getZoomFactor()}`,
  );
  note(
    near(optWc.getZoomFactor(), expected),
    "...and the opt-in host is not changed by it",
    `${optWc.getZoomFactor()}`,
  );
  note(
    near(plain.webContents.getZoomFactor(), SAVED),
    "a second ordinary (non-Couch) page on A keeps its own saved zoom, correct for non-Couch contents",
    `${plain.webContents.getZoomFactor()}`,
  );

  // Cross-origin navigation and back.
  await optWc.loadURL(ORIGIN_B + "/");
  await loaded(optWc, ORIGIN_B);
  note(
    near(optWc.getZoomFactor(), expected),
    "after navigating to another origin",
    `${optWc.getZoomFactor()}`,
  );
  optWc.navigationHistory.goBack();
  await loaded(optWc, ORIGIN_A);
  note(
    near(optWc.getZoomFactor(), expected),
    "after going back to origin A",
    `${optWc.getZoomFactor()}`,
  );

  // Idle unload and recreate.
  opt.hide();
  before = ids();
  opt.unload();
  const recreated = newContents(before);
  opt.show();
  await loaded(recreated, ORIGIN_A);
  note(
    near(recreated.getZoomFactor(), expected),
    "after idle unload and recreate: new contents at the formula's zoom",
    `${recreated.getZoomFactor()}`,
  );
  note(
    near(plain.webContents.getZoomFactor(), SAVED),
    "...and still isolated (saved default-mode zoom untouched)",
    `plain page on A: ${plain.webContents.getZoomFactor()}`,
  );
  const again = await samples(recreated);
  note(
    again.every((x) => Math.abs(x.w * expected - width) <= 2),
    "recreated contents' first paint is not at a wrong zoom",
    again.map((x) => `${x.at}=${x.w}`).join(" "),
  );

  console.log("\nResult  Check                                                          Detail");
  for (const [ok, what, detail] of rows)
    console.log(`${ok ? "PASS  " : "FAIL  "}  ${what.padEnd(62)} ${detail}`);
  const failed = rows.filter((r) => !r[0]).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  return failed ? 1 : 0;
}
