// pnpm webkit-selftest: runs scripts/webkit-selftest.mts in Electron (headless, exits by itself).
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync("./node_modules/.bin/electron", ["scripts/webkit-selftest.mts"], {
  env,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
