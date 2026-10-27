// Runs the headless real-Electron check of Home wallpaper photos (scripts/real-photos-check.mts).
// It uses a fresh temp userData and shows no window. Exit code 1 if any check fails.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync("./node_modules/.bin/electron", ["scripts/real-photos-check.mts"], {
  env,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
