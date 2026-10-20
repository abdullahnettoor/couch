// Visual harness: does NSGlassEffectView between the video and the (transparent) web contents blur the video
// while a crisp web element stays on top? Run: env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/glass-harness.mts
import { app, BrowserWindow, nativeImage } from "electron";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const addon = createRequire(import.meta.url)(resolve("native/mpv-embed/mpv_embed.node"));
const out = process.env.OUT ?? tmpdir();
let failed = false;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
  if (!ok) failed = true;
};
// dock rect in CSS px; a red crisp box sits inside it
const R = { x: 200, y: 450, w: 600, h: 120, r: 40 };
const EXTRA = {
  pause: { x: 880, y: 150, w: 150, h: 150, r: 75 },
  volume: { x: 1100, y: 150, w: 80, h: 380, r: 40 },
  card: { x: 200, y: 40, w: 560, h: 300, r: 60 },
};
const extraHtml = Object.values(EXTRA)
  .map(
    (e) =>
      `<div style="position:fixed;left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;border-radius:${e.r}px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)"></div><div style="position:fixed;left:${e.x + e.w / 2 - 10}px;top:${e.y + e.h / 2 - 10}px;width:20px;height:20px;background:rgb(255,0,0)"></div>`,
  )
  .join("");
const html = `<body style="margin:0;background:transparent">${extraHtml}<div style="position:fixed;left:${R.x}px;top:${R.y}px;width:${R.w}px;height:${R.h}px;border-radius:${R.r}px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)"></div><div style="position:fixed;left:${R.x + 20}px;top:${R.y + 40}px;width:40px;height:40px;background:rgb(255,0,0)"></div></body>`;
void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    x: 100,
    y: 100,
    transparent: true,
    ...(process.env.HIDDEN
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 12 } }
      : {}),
    backgroundColor: "#00000000",
  });
  win.setAlwaysOnTop(true, "floating");
  await win.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  const sock = join(mkdtempSync(join(tmpdir(), "glass-")), "mpv.sock");
  const id = addon.create(win.getNativeWindowHandle(), {
    config: "no",
    idle: "yes",
    "input-ipc-server": sock,
    osc: "no",
    "osd-level": "0",
    hwdec: "auto",
    "keep-open": "yes",
    "input-default-bindings": "no",
  });
  console.log("glassSupported", addon.glassSupported());
  const { MpvIpcClient } = await import(resolve("src/main/mpv/ipc-client.ts"));
  const c = await MpvIpcClient.connect(sock, { timeoutMs: 8000 });
  await c.command(["loadfile", resolve(".dev/sample.mkv")]);
  addon.setVisible(id, true);
  await c.command(["set_property", "pause", true]);
  await sleep(2000);
  // std-dev of luma in a region: sharp test pattern = high, blurred = low
  const grab = (label: string) => {
    const bw = win.isFullScreen() ? win.getBounds() : win.getContentBounds();
    const f = join(out, `glass-${label}.png`);
    execFileSync("screencapture", ["-x", "-R", `${bw.x},${bw.y},${bw.width},${bw.height}`, f]);
    const img = nativeImage.createFromPath(f);
    const { width, height } = img.getSize();
    const [cw, ch] = win.getContentSize();
    const k = width / cw;
    const b = img.toBitmap();
    const at = (cx: number, cy: number) => {
      const i = (Math.round(cy * k) * width + Math.round(cx * k)) * 4;
      return [b[i + 2], b[i + 1], b[i]];
    };
    // sharpness = biggest jump between neighbouring pixels along a row crossing colour-bar edges
    const sharp = (x0: number, x1: number, y: number) => {
      let m = 0,
        prev = at(x0, y);
      for (let x = x0 + 1; x < x1; x++) {
        const p = at(x, y);
        m = Math.max(
          m,
          Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) + Math.abs(p[2] - prev[2]),
        );
        prev = p;
      }
      return m;
    };
    const sx = 1;
    const region = sharp(
      Math.round((R.x + 200) * sx),
      Math.round((R.x + 500) * sx),
      Math.round(R.y + 90),
    );
    const outside = sharp(Math.round((R.x + 200) * sx), Math.round((R.x + 500) * sx), 300);
    const red = at(Math.round((R.x + 40) * sx), R.y + 60);
    const sharpV = (x: number, y0: number, y1: number) => {
      let m = 0,
        prev = at(x, y0);
      for (let y = y0 + 1; y < y1; y++) {
        const p = at(x, y);
        m = Math.max(
          m,
          Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) + Math.abs(p[2] - prev[2]),
        );
        prev = p;
      }
      return m;
    };
    const extras = {
      pause: sharp(EXTRA.pause.x + 25, EXTRA.pause.x + 125, EXTRA.pause.y + 105),
      volume: sharpV(EXTRA.volume.x + 20, EXTRA.volume.y + 40, EXTRA.volume.y + 340),
      card: sharp(EXTRA.card.x + 60, EXTRA.card.x + 500, EXTRA.card.y + 60),
      red: at(EXTRA.card.x + 280, EXTRA.card.y + 150),
    };
    console.log(label, { region: region.toFixed(1), outside: outside.toFixed(1), red });
    return { region, outside, red, extras };
  };
  const rect = () => addon.setGlass(id, 0, R.x, R.y, R.w, R.h, R.r, 1);
  console.log("color", addon.getColor(id));
  const off = grab("off");
  rect();
  await sleep(800);
  const on = grab("on");
  check(
    "glass blurs video behind dock",
    on.region < off.region * 0.5,
    `${on.region.toFixed(1)} vs ${off.region.toFixed(1)}`,
  );
  check("outside glass stays sharp", on.outside > on.region * 2);
  check(
    "web element crisp on top",
    on.red[0] > 200 && on.red[1] < 60 && on.red[2] < 60,
    JSON.stringify(on.red),
  );
  win.setPosition(300, 200);
  win.setSize(1280, 720);
  await sleep(1000);
  const slots = Object.values(EXTRA);
  slots.forEach((e, i) => addon.setGlass(id, i + 1, e.x, e.y, e.w, e.h, e.r, 1));
  await sleep(800);
  const many = grab("many");
  for (const k of ["pause", "volume", "card"] as const)
    check(
      `${k} glass blurs video`,
      many.extras[k] < off.extras[k] * 0.5,
      `${many.extras[k].toFixed(1)} vs ${off.extras[k].toFixed(1)}`,
    );
  check("card content crisp on top", many.extras.red[0] > 200 && many.extras.red[1] < 60);
  slots.forEach((e, i) => addon.setGlass(id, i + 1, e.x, e.y, e.w, e.h, e.r, 0));
  await sleep(800);
  const manyGone = grab("many-gone");
  for (const k of ["pause", "volume", "card"] as const)
    check(
      `${k}: no leftover glass`,
      manyGone.extras[k] > many.extras[k] * 2,
      manyGone.extras[k].toFixed(1),
    );
  const mv = grab("moved");
  check("moved: still blurred", mv.region < mv.outside * 0.5);
  win.setFullScreen(true);
  await sleep(3000);
  rect();
  await sleep(800);
  const fs = grab("fullscreen");
  check("fullscreen: blurred", fs.region < fs.outside * 0.5);
  win.setFullScreen(false);
  await sleep(3000);
  addon.setGlass(id, 0, R.x, R.y, R.w, R.h, R.r, 0);
  await sleep(800);
  const gone = grab("hidden");
  check("hidden: no leftover glass", gone.region > on.region * 2, `${gone.region.toFixed(1)}`);
  addon.destroy(id);
  app.exit(failed ? 1 : 0);
});
