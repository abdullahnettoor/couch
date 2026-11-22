// pnpm webkit-zoom-check: runs scripts/webkit-zoom-check.mts in Electron twice on one throwaway WebKit store (save, then
// check after a relaunch), headless; the check phase removes the store. If either launch fails, a third launch removes
// the store before exiting with the failing status. Exits non-zero on any failure.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.COUCH_ZOOM_STORE = randomUUID().toUpperCase();
const launch = (phase) =>
  spawnSync("./node_modules/.bin/electron", ["scripts/webkit-zoom-check.mts"], {
    env: { ...env, COUCH_ZOOM_PHASE: phase },
    stdio: "inherit",
  }).status ?? 1;
let status = 0;
for (const phase of ["save", "check"]) {
  status = launch(phase);
  if (status !== 0) break;
}
if (status !== 0) launch("cleanup");
process.exit(status);
