// pnpm bitchord:sizes [outDir]: runs scripts/bitchord-textsize-frames.mts in Electron (offscreen, muted, temp userData). Hits the live site; by hand, not CI.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(
  "./node_modules/.bin/electron",
  ["scripts/bitchord-textsize-frames.mts", ...process.argv.slice(2)],
  { env, stdio: "inherit" },
);
process.exit(run.status ?? 1);
