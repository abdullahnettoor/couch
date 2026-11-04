// The screenshot harness for the Look: snap every surface to PNGs from fixed data, then diff two folders of them.
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/look-snap.mts snap <dir>
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/look-snap.mts diff <base> <head> [--tolerance N]
// `snap` needs the built Screen and phone page (`vp build` and `node scripts/write-remote-page.mjs`). It opens no visible window:
// every page is rendered offscreen. Documented in CONTRIBUTING.md ("Screenshots").
import { app, BrowserWindow } from "electron";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { quickSettingsPage } from "../src/shared/quick-settings-page.ts";
import {
  confirmScript,
  noteScript,
  searchBarScript,
  volumeScript,
} from "../src/main/web/web-hud.ts";
import { DEFAULT_TOLERANCE, decodePng, diffFolders, isBlank } from "./look-diff.ts";
import { loadFixtures } from "./look-fixture-data.ts";

const [mode, ...args] = process.argv.slice(2).filter((a) => !a.startsWith("--inspect"));
const SCREEN = { width: 1920, height: 1080 };
const PHONE = { width: 430, height: 932 };

// Child processes inherit this, so the clock reads the same wherever the harness runs.
process.env.TZ = "UTC";
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-gpu-vsync");
app.dock?.hide();

if (mode === "diff") {
  const [base, head] = args;
  const flag = args.indexOf("--tolerance");
  const tolerance = flag >= 0 ? Number(args[flag + 1]) : DEFAULT_TOLERANCE;
  if (!base || !head || !(tolerance >= 0)) usage();
  const out = join(head, "diff");
  const r = diffFolders(base, head, { outDir: out, tolerance });
  console.log(`compared ${r.compared} images (tolerance ${tolerance} of 255 per channel)`);
  for (const name of r.missingInHead) console.log(`MISSING in head: ${name}`);
  for (const name of r.missingInBase) console.log(`MISSING in base: ${name}`);
  for (const d of r.differing)
    console.log(
      `DIFF ${d.name}: ${d.pixels} pixels${d.sizeMismatch ? " (size changed)" : ""} → ${join(out, d.name)}`,
    );
  const bad = r.differing.length + r.missingInHead.length + r.missingInBase.length;
  console.log(`${r.differing.length} images differ`);
  process.exit(bad ? 1 : 0);
} else if (mode === "snap") {
  if (!args[0]) usage();
  void snapAll(resolve(args[0])).then(
    (n) => {
      console.log(`wrote ${n} images to ${resolve(args[0])}`);
      app.exit(0);
    },
    (error) => {
      console.error(`FAIL ${error instanceof Error ? error.message : error}`);
      app.exit(1);
    },
  );
} else usage();

function usage(): never {
  console.error("usage: look-snap.mts snap <dir> | diff <base> <head> [--tolerance N]");
  process.exit(2);
}

async function snapAll(dir: string): Promise<number> {
  await app.whenReady();
  mkdirSync(dir, { recursive: true });
  const fixtures = loadFixtures();
  const preload = join(import.meta.dirname, "look-snap-preload.cjs");
  const scratch = mkdtempSync(join(tmpdir(), "look-snap-"));
  let count = 0;

  // One offscreen window per size, reused: each shot starts from a fresh navigation, so no page state carries over.
  const windows = new Map<string, BrowserWindow>();
  const windowFor = (size: { width: number; height: number }) => {
    const key = `${size.width}x${size.height}`;
    let win = windows.get(key);
    if (!win) {
      win = new BrowserWindow({
        ...size,
        show: false,
        useContentSize: true,
        frame: false,
        backgroundColor: "#1c1d21",
        webPreferences: {
          offscreen: true,
          preload,
          contextIsolation: false,
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      win.webContents.setFrameRate(30);
      windows.set(key, win);
    }
    return win;
  };

  /** Lets `load` fill the window, waits until the page is ready (fonts, pictures) and painted, checks the page didn't throw or draw nothing, and saves the capture. */
  async function shot(
    name: string,
    size: { width: number; height: number },
    load: (win: BrowserWindow) => Promise<void>,
  ) {
    const win = windowFor(size);
    const wc = win.webContents;
    const log = (m: string) => process.env.LOOK_SNAP_LOG && console.log(`… ${name} ${m}`);
    log("open");
    let onGone: (() => void) | undefined;
    const gone = new Promise<never>((_, reject) => {
      onGone = () => reject(new Error(`${name}: the renderer process died`));
      wc.once("render-process-gone", onGone);
    });
    try {
      await Promise.race([load(win), gone]);
      log("loaded");
      await wc.executeJavaScript("window.__ready()");
      log("ready");
      // A frame composited after the page was ready, so the capture can't be an older one.
      const painted = new Promise<void>((r) => wc.once("paint", () => r()));
      wc.invalidate();
      await Promise.race([painted, gone]);
      log("painted");
      const errors: string[] = await wc.executeJavaScript("window.__errors");
      if (errors.length) throw new Error(`${name}: the page threw: ${errors.join("; ")}`);
      log("capturing");
      const image = await wc.capturePage();
      log("captured");
      const png = image.toPNG();
      const pixels = decodePng(png);
      if (pixels.width !== size.width || pixels.height !== size.height)
        throw new Error(
          `${name}: captured ${pixels.width}x${pixels.height}, expected ${size.width}x${size.height}`,
        );
      if (isBlank(pixels))
        throw new Error(`${name}: the capture is a single colour (the page drew nothing)`);
      writeFileSync(join(dir, `${name}.png`), png);
      count++;
    } catch (error) {
      for (const w of windows.values()) w.destroy();
      throw error;
    } finally {
      wc.removeListener("render-process-gone", onGone!);
    }
  }

  // A stand-in for the video behind the Screen and a Web App's page: a fixed gradient with some detail, so glass has something to blur.
  const BACKDROP =
    "linear-gradient(115deg,#7a4b2e 0%,#2e5c7a 35%,#c9b458 55%,#3a2f55 80%,#1d6b52 100%)";

  for (const [name, payload] of Object.entries(fixtures.screen)) {
    await shot(`screen-${name}`, SCREEN, async (win) => {
      await win.loadFile(join(import.meta.dirname, "../dist/renderer/index.html"));
      await win.webContents.executeJavaScript(
        `document.documentElement.style.background=${JSON.stringify(BACKDROP)};window.__screen(${JSON.stringify(payload)});0`,
      );
    });
  }

  const phonePage = join(scratch, "remote.html");
  writeFileSync(phonePage, readFileSync(join(import.meta.dirname, "../dist/remote/page.html")));
  for (const [name, snapshot] of Object.entries(fixtures.phone)) {
    await shot(`phone-${name}`, PHONE, async (win) => {
      await win.loadFile(phonePage, { query: { key: "fixture" } });
      await win.webContents.executeJavaScript(`window.__phone(${JSON.stringify(snapshot)});0`);
    });
  }
  // Now Playing's D-pad view: the chip that opens it.
  await shot("phone-player-dpad", PHONE, async (win) => {
    await win.loadFile(phonePage, { query: { key: "fixture" } });
    await win.webContents.executeJavaScript(
      `window.__phone(${JSON.stringify(fixtures.phone.player)});document.getElementById("chip-pad").click();0`,
    );
  });

  const quick = fixtures.screen["overlay-quick-settings"].quick;
  const drawerPage = join(scratch, "quick.html");
  writeFileSync(drawerPage, quickSettingsPage());
  await shot("quick-drawer", SCREEN, async (win) => {
    await win.loadFile(drawerPage);
    await win.webContents.executeJavaScript(
      `document.documentElement.style.background=${JSON.stringify(BACKDROP)};window.__quick(${JSON.stringify(quick)});window.__drawerIn`,
    );
  });

  // A Web App's own controls drawn over a plain page by the scripts Couch injects.
  const plain = `data:text/html,${encodeURIComponent(`<body style="margin:0;height:100vh;background:${BACKDROP}"><h1 style="font:600 64px sans-serif;color:#fff;padding:120px">A page</h1></body>`)}`;
  const confirm = fixtures.screen["overlay-confirm"].state.confirm;
  const controls: Array<[string, string]> = [
    ["web-volume", volumeScript(65)],
    ["web-note", noteScript("Phone connected")],
    ["web-confirm", confirmScript(confirm)],
    ["web-search", searchBarScript("arcane", "Search YouTube")],
    ["web-search-empty", searchBarScript("", "Search YouTube")],
  ];
  for (const [name, script] of controls) {
    await shot(name, SCREEN, async (win) => {
      await win.loadURL(plain);
      await win.webContents.executeJavaScript(`${script};0`);
    });
  }
  for (const w of windows.values()) w.destroy();
  return count;
}
