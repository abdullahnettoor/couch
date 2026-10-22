// pnpm drm-check [--url <service url>]: Widevine test stream report, or open a service on its own partition.
// Uses the dev-electron binary from node_modules (never Couch's own userData). Not part of the app bundle.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { evsState, validSignature } from "../lib/evs-cli.mts";

const electronBin = createRequire(import.meta.url)("electron");
const evs = evsState();
const vmp = !evs.cliInstalled
  ? "unknown (castlabs-evs not installed)"
  : validSignature("node_modules/electron/dist")
    ? "valid VMP signature on node_modules/electron/dist"
    : "no valid production VMP signature (dev-signed only; run `pnpm sign:dev`)";
console.log(`[drm-check] VMP status: ${vmp}`);

const args = [
  new URL("./main.cjs", import.meta.url).pathname,
  ...process.argv.slice(2).filter((a) => a !== "--"),
];
const child = spawn(electronBin, args, {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
child.on("exit", (code) => process.exit(code ?? 1));
