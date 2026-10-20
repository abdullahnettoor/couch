// Visual harness: does a web element draw over the embedded video? OPTION=A|B
import { app, BrowserWindow, WebContentsView, nativeImage } from "electron";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const OPT = process.env.OPTION ?? "A";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const addon = createRequire(import.meta.url)(resolve("native/mpv-embed/mpv_embed.node"));
const results: string[] = [];
let failed = false;
const check = (name: string, ok: boolean, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
  if (!ok) failed = true;
};
const page = (bg: string) =>
  `data:text/html,<body style="margin:0;background:${bg}"><div id=box style="position:fixed;left:100px;top:100px;width:200px;height:200px;background:rgb(255,0,0)"></div></body>`;
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    x: 100,
    y: 100,
    show: true,
    transparent: OPT === "A",
    backgroundColor: OPT === "A" ? "#00000000" : "#0000ff",
  });
  let overlay: WebContentsView | undefined;
  await win.loadURL(page("rgb(0,0,255)"));
  if (OPT === "B") {
    overlay = new WebContentsView({ webPreferences: {} });
    overlay.setBackgroundColor("#00000000");
    win.contentView.addChildView(overlay);
    const fit = () => overlay!.setBounds({ x: 0, y: 0, ...win.getContentBounds() });
    const fit2 = () => {
      const [w, h] = win.getContentSize();
      overlay!.setBounds({ x: 0, y: 0, width: w, height: h });
    };
    fit2();
    win.on("resize", fit2);
    await overlay.webContents.loadURL(page("transparent"));
  }
  const web = overlay?.webContents ?? win.webContents;
  const sock = join(mkdtempSync(join(tmpdir(), "layer-")), "mpv.sock");
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
  addon.setPlacement(id, OPT === "A" && process.env.PLACE !== "above");
  const { MpvIpcClient } = await import(resolve("src/main/mpv/ipc-client.ts"));
  const c = await MpvIpcClient.connect(sock, { timeoutMs: 8000 });
  const px = (img: Electron.NativeImage, fx: number, fy: number) => {
    const { width, height } = img.getSize();
    const b = img.toBitmap();
    const x = Math.round(fx * (width - 1)),
      y = Math.round(fy * (height - 1)),
      i = (y * width + x) * 4;
    return { r: b[i + 2], g: b[i + 1], b: b[i] }; // BGRA
  };
  const snap = async (label: string, expectVideo: boolean) => {
    const bw = win.isFullScreen() ? win.getBounds() : win.getContentBounds();
    const f = join(tmpdir(), `layer-${label}.png`);
    execFileSync("screencapture", ["-x", "-R", `${bw.x},${bw.y},${bw.width},${bw.height}`, f]);
    const img = nativeImage.createFromPath(f);
    const sz = img.getSize();
    // red box at css (100..300) within the web content; sample its centre and a point in the video area
    const [cw, ch] = win.getContentSize();
    const red = px(img, 200 / cw, 200 / ch);
    const away = px(img, 0.7, 0.7);
    const isRed = red.r > 200 && red.g < 60 && red.b < 60;
    const isBlue = away.b > 200 && away.r < 60 && away.g < 60;
    check(`${label}: red box visible`, isRed, JSON.stringify(red));
    if (expectVideo)
      check(
        `${label}: video visible beside box`,
        !isBlue && !(away.r < 5 && away.g < 5 && away.b < 5),
        JSON.stringify(away),
      );
    else check(`${label}: screen opaque, no video`, isBlue, JSON.stringify(away));
    console.log(label, sz, JSON.stringify({ red, away }));
  };
  await sleep(500);
  await snap("idle", false);
  await c.command(["loadfile", resolve(".dev/sample.mkv")]);
  addon.setVisible(id, true);
  if (OPT === "A") await web.executeJavaScript(`document.body.style.background='transparent'`);
  await sleep(2500);
  await snap("windowed", true);
  const hw = await c.command(["get_property", "hwdec-current"]);
  check("hwdec-current", typeof hw === "string" && hw !== "no" && hw !== "", String(hw));
  win.setPosition(300, 200);
  win.setSize(1000, 600);
  await sleep(1200);
  await snap("moved-resized", true);
  win.setFullScreen(true);
  await sleep(3000);
  await snap("fullscreen", true);
  win.setFullScreen(false);
  await sleep(3000);
  await snap("windowed-again", true);
  addon.setVisible(id, false);
  if (OPT === "A") await web.executeJavaScript(`document.body.style.background='rgb(0,0,255)'`);
  await sleep(800);
  await snap("stopped", false);
  try {
    console.log(
      "ONSCREEN",
      execFileSync(".debug/onscreen", { encoding: "utf8" })
        .split("\n")
        .filter((l) => /mpv|Electron/i.test(l))
        .join(" | "),
    );
  } catch {}
  console.log(results.join("\n"));
  c.close();
  addon.destroy(id);
  app.exit(failed ? 1 : 0);
});
