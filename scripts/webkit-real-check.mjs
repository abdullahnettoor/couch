// The agent's WebKit real check (ticket 110): Couch on a temp userData, own ports and non-persistent WebKit stores.
// It opens a visible window, so run it only when the Mac is free. It refuses to start with anything that could
// touch the household's Couch (see src/main/web/webkit-real-check.ts). Run `vp run build` first.
// Usage: node scripts/webkit-real-check.mjs [--dry-run]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webkitRealCheckLaunch } from "../src/main/web/webkit-real-check.ts";

const userData = mkdtempSync(join(tmpdir(), "couch-webkit-check-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const launch = webkitRealCheckLaunch(userData, env);
console.log(`userData ${userData}`);
console.log(
  `Remote port ${launch.env.COUCH_PORT}, app port ${launch.env.COUCH_APP_PORT}, ephemeral stores`,
);
if (process.argv.includes("--dry-run")) process.exit(0);
const child = spawn("node", launch.args, { env: launch.env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
