// pnpm textsize:check: the real-Electron check of Text size's zoom isolation (#58), run by hand, never in CI.
// It runs scripts/textsize-real-check.mts in Electron twice on one temp userData (under $TMPDIR): once to save a default-mode
// zoom for an origin, once after a restart to load Couch's real web-App host over that origin. Offscreen, local pages on
// non-default ports, no network. Prints a pass/fail table and exits 1 on any failure.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const userData = mkdtempSync(join(tmpdir(), "couch-textsize-check-"));
env.COUCH_TEXTSIZE_USER_DATA = userData;
let status = 0;
for (const phase of ["save", "check"]) {
  env.COUCH_TEXTSIZE_PHASE = phase;
  const run = spawnSync("./node_modules/.bin/electron", ["scripts/textsize-real-check.mts"], {
    env,
    stdio: "inherit",
  });
  status = run.status ?? 1;
  if (status !== 0) break;
}
rmSync(userData, { recursive: true, force: true });
process.exit(status);
