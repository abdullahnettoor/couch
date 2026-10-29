import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

/** Couch's real ports: the Remote's public one, and the app port behind the listener. The check never uses them. */
export const HOUSEHOLD_PORTS = [4747, 4748];

/** Own ports for the agent's real check: neither is a default, so it can't meet the household's Couch or its listener. */
export const CHECK_PORTS = { remote: 47747, app: 47748 };

/** The environment the agent's WebKit real check runs Couch with. A temp userData and non-persistent stores, own ports, WebKit on. */
export function webkitRealCheckEnv(base: Record<string, string | undefined> = {}) {
  return {
    ...base,
    COUCH_NETFLIX_ENGINE: "webkit",
    COUCH_WEBKIT_EPHEMERAL: "1",
    COUCH_PORT: String(CHECK_PORTS.remote),
    COUCH_APP_PORT: String(CHECK_PORTS.app),
    COUCH_DISPLAY: "internal",
  };
}

const isPort = (v: string | undefined): v is string => /^\d{4,5}$/.test(v ?? "");

/**
 * Throws when the check could touch the household's Couch: a default or missing port, a store that persists,
 * the wrong engine, or a userData that is not a folder inside the temp directory (the household's own
 * `~/Library/Application Support/couch` is never one).
 */
export function assertSafeWebkitRealCheck(
  env: Record<string, string | undefined>,
  userDataDir: string,
  temp: string = tmpdir(),
): void {
  for (const name of ["COUCH_PORT", "COUCH_APP_PORT"] as const) {
    const value = env[name];
    if (!isPort(value)) throw new Error(`${name} must be set to an explicit port`);
    if (HOUSEHOLD_PORTS.includes(Number(value))) throw new Error(`${name} is a household port`);
  }
  if (env.COUCH_PORT === env.COUCH_APP_PORT)
    throw new Error("COUCH_PORT and COUCH_APP_PORT must differ");
  if (env.COUCH_WEBKIT_EPHEMERAL !== "1") throw new Error("COUCH_WEBKIT_EPHEMERAL must be 1");
  if (env.COUCH_NETFLIX_ENGINE !== "webkit") throw new Error("COUCH_NETFLIX_ENGINE must be webkit");
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const root = real(temp);
  const dir = real(userDataDir);
  if (
    dir === root ||
    !dir.startsWith(root + sep) ||
    dir.includes(`${sep}Application Support${sep}`)
  )
    throw new Error(`userData must be a new folder inside ${root}`);
}

/** The command line the agent's real check runs: `node scripts/dev-electron.mjs --user-data-dir=<tmp>` with the env. */
export function webkitRealCheckLaunch(
  userDataDir: string,
  base: Record<string, string | undefined>,
) {
  const env = webkitRealCheckEnv(base);
  assertSafeWebkitRealCheck(env, userDataDir);
  return { args: ["scripts/dev-electron.mjs", `--user-data-dir=${userDataDir}`], env };
}
