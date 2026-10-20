// real-app loop: play, pause, dock up, capture, measure dock icon sharpness
import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import WebSocket from "ws";
const D = "/private/var/folders/2c/pdz03qld3cs_snx4m806nh1h0000gn/T/opencode/couch-029";
const OUT = process.env.OUT ?? "/tmp/real.png";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = spawn("./node_modules/.bin/electron", [".", `--user-data-dir=${D}/data`], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "",
    COUCH_PORT: "4798",
    COUCH_DISPLAY: "internal",
    COUCH_NATIVE_GLASS: process.env.NG ?? "1",
  },
  stdio: "ignore",
});
delete process.env.ELECTRON_RUN_AS_NODE;
await sleep(6000);
const key = JSON.parse(readFileSync(`${D}/data/pairing.json`, "utf8")).key;
const ws = new WebSocket(`ws://localhost:4798/ws?key=${encodeURIComponent(key)}`);
let last;
ws.on("message", (m) => (last = JSON.parse(m.toString())));
await new Promise((r) => ws.on("open", r));
const press = async (c, w = 500) => {
  ws.send(JSON.stringify({ type: "command", command: c }));
  await sleep(w);
};
try {
  await press("home", 1500);
  await press("right");
  await press("ok", 6000);
  console.log("view", last?.view);
  await press("playpause", 1500);
  await press("down", 1500);
  for (const k of (process.env.KEYS ?? "").split(",").filter(Boolean)) await press(k, 800);
  console.log("paused", last?.player?.paused);
  try {
    execFileSync("osascript", ["-e", 'tell application "Electron" to activate']);
  } catch {}
  await sleep(2500);
  if (process.env.WINDOWED) {
    execFileSync("osascript", [
      "-e",
      'tell application "System Events" to keystroke "f" using {control down, command down}',
    ]);
    await sleep(4000);
  }
  execFileSync("screencapture", ["-x", OUT]);
  console.log("saved", OUT);
  if (process.env.HOLD) await sleep(Number(process.env.HOLD));
} finally {
  ws.close();
  app.kill();
  execFileSync("pkill", ["-f", "couch-029/data"]).toString;
}
process.exit(0);
