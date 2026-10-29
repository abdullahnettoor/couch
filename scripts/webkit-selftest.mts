// Headless WebKit self-test (ticket 110): FairPlay availability, HTMLMediaElement.setSinkId, enumerateDevices and key delivery
// through the native add-on, in a detached WKWebView in a window that is never shown. Exits by itself; no network, no
// data store, no window, no Couch userData. Run: node scripts/webkit-selftest.mjs
import { app } from "electron";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  SELF_TEST_EXPECTED_EVENTS,
  SELF_TEST_EXPECTED_MOVE,
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
    const summary = summarizeSelfTest(raw);
    console.log(`SELFTEST summary=${JSON.stringify(summary)}`);
    const missing: string[] = SELF_TEST_EXPECTED_EVENTS.filter((e) => !summary.keys.includes(e));
    if (
      !summary.moves.some(
        (m) => m[0] === SELF_TEST_EXPECTED_MOVE[0] && m[1] === SELF_TEST_EXPECTED_MOVE[1],
      )
    ) {
      missing.push(`mousemove at ${SELF_TEST_EXPECTED_MOVE.join(",")}`);
    }
    if (missing.length > 0) console.log(`SELFTEST missing ${missing.join(", ")}`);
    clearTimeout(timeout);
    app.exit(missing.length > 0 ? 1 : 0);
  } catch (error) {
    console.log(`SELFTEST error ${String(error)}`);
    app.exit(1);
  }
});
