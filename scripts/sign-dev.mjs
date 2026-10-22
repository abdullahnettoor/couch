// VMP-signs the dev Electron so DRM Apps can be tried. Only needed for DRM work; exits 0 without EVS.
import { rmSync } from "node:fs";
import { evsState, signPkg, validSignature } from "./lib/evs-cli.mts";
import { signDevPlan } from "./lib/evs.mts";

const plan = signDevPlan({
  evs: evsState(),
  targets: ["node_modules/electron/dist"],
  validSignature,
});
if (plan.action === "skip") {
  console.log(plan.help);
} else if (plan.action === "up-to-date") {
  console.log("Dev Electron already has a valid VMP signature; nothing to do.");
} else {
  for (const target of plan.targets) {
    if (!signPkg(target)) {
      console.error(`VMP signing failed for ${target}.`);
      process.exit(1);
    }
  }
  // `pnpm dev` runs a renamed copy; drop it so the next start copies the signed Electron.
  rmSync("node_modules/.cache/couch-dev", { recursive: true, force: true });
  console.log("Signed. Start Couch as usual.");
}
