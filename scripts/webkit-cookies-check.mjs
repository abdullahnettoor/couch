// pnpm webkit-cookies-check: runs scripts/webkit-cookies-check.mts in Electron (headless, exits by itself).
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync("./node_modules/.bin/electron", ["scripts/webkit-cookies-check.mts"], {
  env,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
