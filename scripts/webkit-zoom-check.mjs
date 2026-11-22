// pnpm webkit-zoom-check: runs scripts/webkit-zoom-check.mts in Electron twice on one throwaway WebKit store (save, then
// check after a relaunch), headless; the check phase removes the store. Exits 1 on any failure.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.COUCH_ZOOM_STORE = randomUUID().toUpperCase();
let status = 0;
for (const phase of ["save", "check"]) {
  env.COUCH_ZOOM_PHASE = phase;
  const run = spawnSync("./node_modules/.bin/electron", ["scripts/webkit-zoom-check.mts"], {
    env,
    stdio: "inherit",
  });
  status = run.status ?? 1;
  if (status !== 0) break;
}
process.exit(status);
