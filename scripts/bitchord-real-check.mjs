// pnpm bitchord:real: runs scripts/bitchord-real-check.mts in Electron (offscreen, muted, temp userData; exits by itself).
// It hits the live BitChord site and plays audio (muted), so run it by hand, never in CI.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync("./node_modules/.bin/electron", ["scripts/bitchord-real-check.mts"], {
  env,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
