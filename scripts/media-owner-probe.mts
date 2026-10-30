// Ticket 121 probe: does Chromium itself publish Now Playing / take the remote commands for a playing page? Hidden window, local
// audio, navigator.mediaSession.metadata set. Run with and without COUCH_PROBE_FLAGS=1 (the disable-features flags Couch sets).
// Own userData in a temp dir; no visible window, no input.
import { app, BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "couch-owner-probe-"));
app.setPath("userData", join(dir, "ud"));
if (process.env.COUCH_PROBE_FLAGS === "1")
  app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling,MediaSessionService");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.dock?.hide();

const addon = createRequire(import.meta.url)(resolve("native/mpv-embed/mpv_embed.node"));

function wav(seconds: number): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin(i / 5));
  return b;
}

void app.whenReady().then(async () => {
  writeFileSync(join(dir, "a.wav"), wav(30));
  writeFileSync(
    join(dir, "p.html"),
    `<audio id=a src="a.wav" loop></audio><script>
    navigator.mediaSession.metadata = new MediaMetadata({title:"Probe title", artist:"Probe"});
    navigator.mediaSession.setActionHandler("play", () => {});
    navigator.mediaSession.setActionHandler("pause", () => {});
    </script>`,
  );
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(join(dir, "p.html"));
  const played = await win.webContents.executeJavaScript(
    `document.getElementById("a").play().then(() => !document.getElementById("a").paused, e => String(e))`,
  );
  await new Promise((r) => setTimeout(r, 2500));
  const snap = JSON.parse(addon.mediaRemoteSelfTest());
  console.log(
    `PROBE flags=${process.env.COUCH_PROBE_FLAGS === "1"} playing=${played} ` +
      `nowPlayingTitle=${JSON.stringify(snap.title)} playbackState=${snap.state} commandsEnabled=${JSON.stringify(snap.enabled)}`,
  );
  app.exit(0);
});
