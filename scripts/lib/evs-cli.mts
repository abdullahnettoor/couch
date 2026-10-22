// Thin wrappers over castLabs' EVS client. Credentials stay in its own cache.
// Prefers the `evs-vmp` / `evs-account` commands (pipx installs them on PATH); falls back to `python3 -m`.
import { spawnSync } from "node:child_process";

const COMMANDS = { "castlabs_evs.vmp": "evs-vmp", "castlabs_evs.account": "evs-account" } as const;
type Module = keyof typeof COMMANDS;

const onPath = (command: string) => spawnSync("which", [command], { stdio: "ignore" }).status === 0;

const run = (module: Module, args: string[], opts: { inherit?: boolean } = {}) => {
  const stdio = opts.inherit ? "inherit" : "ignore";
  const command = COMMANDS[module];
  const result = onPath(command)
    ? spawnSync(command, args, { stdio })
    : spawnSync("python3", ["-m", module, ...args], { stdio });
  return result.status === 0;
};

export const cliInstalled = () => run("castlabs_evs.vmp", ["--version"]);
// `refresh` in non-interactive mode succeeds only when a login (or EVS_* credentials) already exists.
export const loggedIn = () => run("castlabs_evs.account", ["--no-ask", "refresh"]);
export const evsState = () => {
  const installed = cliInstalled();
  return { cliInstalled: installed, loggedIn: installed && loggedIn(), env: process.env };
};
// `package` is the directory that contains the .app, not the .app itself.
export const validSignature = (pkg: string) =>
  run("castlabs_evs.vmp", ["--no-ask", "verify-pkg", pkg]);
export const signPkg = (pkg: string) =>
  run("castlabs_evs.vmp", ["sign-pkg", pkg], { inherit: true });
export const verifyPkg = (pkg: string) =>
  run("castlabs_evs.vmp", ["verify-pkg", pkg], { inherit: true });
