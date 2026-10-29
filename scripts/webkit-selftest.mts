// Headless WebKit self-test (ticket 110): FairPlay availability, HTMLMediaElement.setSinkId, enumerateDevices and key delivery
// through the native add-on, in a detached WKWebView in a window that is never shown. Exits by itself; no network, no
// data store, no window, no Couch userData. Run: node scripts/webkit-selftest.mjs
import { app } from "electron";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  SELF_TEST_KEYS,
  SELF_TEST_SCRIPT,
  summarizeSelfTest,
} from "../src/main/web/webkit-selftest.ts";
import { webkitSelfTest } from "../src/main/mpv/embed-addon.ts";

const addon = createRequire(import.meta.url)(resolve("native/mpv-embed/mpv_embed.node"));
app.dock?.hide();
void app.whenReady().then(async () => {
  const timeout = setTimeout(() => {
    console.log("SELFTEST timeout");
    app.exit(2);
  }, 30000);
  try {
    const raw = await webkitSelfTest(SELF_TEST_SCRIPT, SELF_TEST_KEYS, () => addon);
    console.log(`SELFTEST raw=${JSON.stringify(raw)}`);
    console.log(`SELFTEST summary=${JSON.stringify(summarizeSelfTest(raw))}`);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.log(`SELFTEST error ${String(error)}`);
    app.exit(1);
  }
});
