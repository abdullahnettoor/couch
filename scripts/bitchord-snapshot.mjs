// pnpm bitchord:snapshot [dir]: runs scripts/bitchord-snapshot.mts in Electron (offscreen, muted, temp userData; exits by itself).
// It hits the live BitChord site, so run it by hand, never in CI.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(
  "./node_modules/.bin/electron",
  ["scripts/bitchord-snapshot.mts", ...process.argv.slice(2)],
  {
    env,
    stdio: "inherit",
  },
);
process.exit(run.status ?? 1);
