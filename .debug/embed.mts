import { app, BrowserWindow, nativeImage } from "electron";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MpvIpcClient } from "../src/main/mpv/ipc-client.ts";

const require = createRequire(import.meta.url);
const addon = require("../native/mpv-embed/mpv_embed.node");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "embed-"));
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
  if (!ok) failures++;
};

function redFraction(x: number, y: number, w: number, h: number, tag: string): number {
  const file = join(dir, `${tag}.png`);
  execFileSync("screencapture", ["-x", "-R", `${x},${y},${w},${h}`, file]);
  const img = nativeImage.createFromBuffer(readFileSync(file));
  const { width, height } = img.getSize();
  const buf = img.toBitmap(); // BGRA
  let red = 0, black = 0, vid = 0, n = 0;
  for (let py = 0; py < height; py += 8)
    for (let px = 0; px < width; px += 8) {
      const i = (py * width + px) * 4;
      const [b, g, r] = [buf[i], buf[i + 1], buf[i + 2]];
      n++;
      if (g > 150 || b > 150) vid++;
      if (r > 200 && g < 60 && b < 60) red++;
      else if (r < 12 && g < 12 && b < 12) black++;
    }
  console.log(`  ${tag}: red=${(red / n).toFixed(2)} video=${(vid / n).toFixed(2)} (${file})`);
  return tag === "idle" || tag === "stopped" ? red / n : vid / n;
}
const listWindows = () => execFileSync("./.debug/onscreen").toString();

async function main() {
const win = new BrowserWindow({ x: 100, y: 100, width: 1280, height: 720, backgroundColor: "#ff0000", show: true, frame: true });
win.loadURL("data:text/html,<body style='background:red;margin:0'>");
await sleep(1000);
const sock = join(dir, "mpv.sock");
const id = addon.create(win.getNativeWindowHandle(), {
  "no-config": "", "idle": "yes", "input-ipc-server": sock, "osc": "no", "hwdec": "auto", "keep-open": "no", "audio": "no", "ao": "null",
});
const client = await MpvIpcClient.connect(sock, { timeoutMs: 5000 });
client.onEvent((e) => { if (e.event === "file-loaded") addon.setVisible(id, true); if (e.event === "end-file") addon.setVisible(id, false); });
const content = () => { const b = win.getContentBounds(); return b; };
let b = content();
check("idle: red before playback", redFraction(b.x, b.y, b.width, b.height, "idle") > 0.9);
await client.command(["loadfile", ".dev/sample.mkv", "replace"]);
await sleep(2500);
check("windowed: video inside", redFraction(b.x, b.y, b.width, b.height, "windowed") > 0.3);
check("no mpv window", !/mpv/i.test(listWindows()), listWindows().split("\n").filter((l) => /mpv/i.test(l)).join());
win.setPosition(300, 200); await sleep(800); b = content();
check("moved: video inside", redFraction(b.x, b.y, b.width, b.height, "moved") > 0.3);
win.setSize(900, 500); await sleep(1000); b = content();
check("resized: video inside", redFraction(b.x, b.y, b.width, b.height, "resized") > 0.3);
win.setFullScreen(true); await sleep(2500);
const sz = win.getBounds();
check("fullscreen: video inside", redFraction(sz.x, sz.y, sz.width, sz.height, "fullscreen") > 0.3);
win.setFullScreen(false); await sleep(2500); b = content();
await client.command(["stop"]); await sleep(1000);
check("stopped: red back", redFraction(b.x, b.y, b.width, b.height, "stopped") > 0.9);
client.close();
addon.destroy(id);
await sleep(300);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
app.exit(failures ? 1 : 0);

}
app.whenReady().then(main);
