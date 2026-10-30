// Headless media-key self-test (ticket 121): through the real Start, SetInfo and Stop, the native add-on registers the remote
// commands, publishes Now Playing, delivers simulated presses through Start's thread-safe callback, and releases it all,
// inside Electron's run loop, with no window, no input and no Couch userData. Run: node scripts/media-remote-selftest.mjs
import { app } from "electron";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const addon = createRequire(import.meta.url)(resolve("native/mpv-embed/mpv_embed.node"));
const state = (): Record<string, unknown> => JSON.parse(addon.mediaRemoteSelfTest());
const tick = () => new Promise((r) => setTimeout(r, 50));
const COMMANDS = ["play", "pause", "toggle", "next", "previous"];

app.dock?.hide();
void app.whenReady().then(async () => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => ok || failures.push(what);
  const received: string[] = [];

  addon.mediaRemoteStop();
  const idle = state();
  check(
    idle.registered === 0 && idle.title === null,
    "something was registered or published while idle",
  );
  check(addon.mediaRemoteSelfPress("toggle") === false, "a press had a handler while idle");

  addon.mediaRemoteStart((c: string) => received.push(c));
  addon.mediaRemoteSetInfo("Self test", "Couch", 12, 60, false);
  const on = state();
  check(on.registered === 5, "expected five registered commands");
  check((on.enabled as boolean[]).every(Boolean), "a command was not enabled");
  check(on.othersOff === true, "seek and skip commands should stay off");
  check(on.title === "Self test", "Now Playing was not published");
  check(on.state === 1, "playback state should be Playing");

  for (const c of COMMANDS) check(addon.mediaRemoteSelfPress(c) === true, `no handler for ${c}`);
  await tick();
  check(
    JSON.stringify(received) === JSON.stringify(COMMANDS),
    `presses did not arrive through Start's callback: ${received.join(",")}`,
  );

  received.length = 0;
  addon.mediaRemoteSelfPress("toggle");
  addon.mediaRemoteStop();
  await tick();
  check(received.length === 0, "a press queued before stop was delivered after it");
  const off = state();
  check(off.registered === 0, "commands stayed registered after stop");
  check(off.title === null, "Now Playing stayed after stop");
  check(addon.mediaRemoteSelfPress("toggle") === false, "a press had a handler after stop");

  addon.mediaRemoteStart((c: string) => received.push(c));
  check(addon.mediaRemoteSelfPress("pause") === true, "restart did not register");
  await tick();
  check(received.join(",") === "pause", "a press after restart was not delivered");
  addon.mediaRemoteStop();

  console.log(failures.length ? `MEDIA-SELFTEST FAIL ${failures.join("; ")}` : "MEDIA-SELFTEST ok");
  app.exit(failures.length ? 1 : 0);
});
