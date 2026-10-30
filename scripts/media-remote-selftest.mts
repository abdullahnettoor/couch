// Headless media-key self-test (ticket 121): the native add-on registers the remote commands, publishes Now Playing and
// releases both, inside Electron's run loop, with no window, no input and no Couch userData. Run: node scripts/media-remote-selftest.mjs
import { app } from "electron";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const addon = createRequire(import.meta.url)(resolve("native/mpv-embed/mpv_embed.node"));
app.dock?.hide();
void app.whenReady().then(() => {
  const raw = addon.mediaRemoteSelfTest();
  console.log(`MEDIA-SELFTEST raw=${raw}`);
  const r = JSON.parse(raw);
  const failures = [
    r.idleInfo !== false && "Now Playing was set before anything registered",
    r.registered !== 5 && "expected five registered commands",
    !r.enabled.every(Boolean) && "a command was not enabled",
    r.othersOff !== true && "seek and skip commands should stay off",
    r.title !== "Self test" && "Now Playing was not published",
    r.state !== 1 && "playback state should be Playing",
    r.enabledAfter !== false && "commands stayed enabled after stop",
    r.infoAfter !== false && "Now Playing stayed after stop",
  ].filter(Boolean);
  console.log(failures.length ? `MEDIA-SELFTEST FAIL ${failures.join("; ")}` : "MEDIA-SELFTEST ok");
  app.exit(failures.length ? 1 : 0);
});
