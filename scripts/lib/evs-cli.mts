// Thin wrappers over castLabs' `castlabs_evs` Python module. Credentials stay in its own cache.
import { spawnSync } from "node:child_process";

const py = (args: string[], opts: { inherit?: boolean } = {}) =>
  spawnSync("python3", ["-m", ...args], { stdio: opts.inherit ? "inherit" : "ignore" }).status ===
  0;

export const cliInstalled = () => py(["castlabs_evs.vmp", "--version"]);
// `refresh` in non-interactive mode succeeds only when a login (or EVS_* credentials) already exists.
export const loggedIn = () => py(["castlabs_evs.account", "--no-ask", "refresh"]);
export const evsState = () => {
  const installed = cliInstalled();
  return { cliInstalled: installed, loggedIn: installed && loggedIn(), env: process.env };
};
// `package` is the directory that contains the .app, not the .app itself.
export const validSignature = (pkg: string) =>
  py(["castlabs_evs.vmp", "--no-ask", "verify-pkg", pkg]);
export const signPkg = (pkg: string) =>
  py(["castlabs_evs.vmp", "sign-pkg", pkg], { inherit: true });
export const verifyPkg = (pkg: string) =>
  py(["castlabs_evs.vmp", "verify-pkg", pkg], { inherit: true });
