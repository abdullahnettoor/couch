import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { systemProbe, type ListenerProbe } from "../listener.ts";
import type { Store } from "./store.ts";
import { LISTENER_LABEL, systemExec, type Exec, type ExecResult } from "./login-item.ts";

/** The placeholder label of Couch's first LaunchAgent, replaced by LISTENER_LABEL. */
export const LEGACY_LISTENER_LABEL = "local.couch.listener";

export const MIGRATION_FAILED_TOAST = "Couldn't update the phone connection; will retry";

const MARKER = "migrations";
const DEFAULT_PORT = 4747;
/** launchctl's exit codes for a job that is not loaded. */
const NOT_LOADED = [3, 113];

export interface MigrationFiles {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, text: string): void;
  remove(path: string): void;
}

const systemFiles: MigrationFiles = {
  exists: existsSync,
  read: (p) => readFileSync(p, "utf8"),
  write: (p, text) => writeFileSync(p, text),
  remove: (p) => rmSync(p, { force: true }),
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ListenerLabelMigration {
  home: string;
  uid: number;
  /** False outside an installed Couch.app (the new item could not run there). */
  available: boolean;
  store: Store;
  exec?: Exec;
  probe?: ListenerProbe;
  fs?: MigrationFiles;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  /** How long the old job gets to free the port, and the new one to answer on it. */
  freeMs?: number;
  readyMs?: number;
  pollMs?: number;
}

export type MigrationResult = "skipped" | "removed" | "migrated" | "rolled-back";

/**
 * One-time, recoverable: moves the household's listener from the legacy label to the current one. The new plist
 * is derived from the old one (same arguments, port and settings); the old job is booted out, the new one
 * started and verified, and only then is the old plist deleted. Any failure puts the old job back from its
 * untouched plist and leaves the marker unwritten, so the next start retries.
 */
export async function migrateListenerLabel(o: ListenerLabelMigration): Promise<MigrationResult> {
  const done = o.store.read<{ listenerLabel?: boolean }>(MARKER, {});
  if (done.listenerLabel || !o.available) return "skipped";
  const exec = o.exec ?? systemExec;
  const probe = o.probe ?? systemProbe;
  const fs = o.fs ?? systemFiles;
  const sleep = o.sleep ?? wait;
  const log = o.log ?? ((m: string) => console.warn(`[couch] ${m}`));
  const pollMs = o.pollMs ?? 250;
  const domain = `gui/${o.uid}`;
  const agents = join(o.home, "Library", "LaunchAgents");
  const oldPlist = join(agents, `${LEGACY_LISTENER_LABEL}.plist`);
  const newPlist = join(agents, `${LISTENER_LABEL}.plist`);
  const mark = () => o.store.write(MARKER, { ...done, listenerLabel: true });

  const launchctl = async (what: string, args: string[], okCodes: number[] = []) => {
    const r: ExecResult = await exec("launchctl", args);
    if (!r.ok && !(r.code !== undefined && okCodes.includes(r.code)))
      throw new Error(`launchctl ${what} failed (exit ${r.code ?? "none"})`);
    return r;
  };
  const loaded = async (label: string) =>
    (await exec("launchctl", ["print", `${domain}/${label}`])).ok;
  const waitFor = async (answers: boolean, ms: number, port: number) => {
    for (let waited = 0; ; waited += pollMs) {
      if ((await probe.portAnswers(port)) === answers) return true;
      if (waited >= ms) return false;
      await sleep(pollMs);
    }
  };

  if (!fs.exists(oldPlist)) {
    mark();
    return "skipped";
  }

  let wasOn: boolean;
  let text: string;
  try {
    const listing = await launchctl("print-disabled", ["print-disabled", domain]);
    const off = new RegExp(
      `"${LEGACY_LISTENER_LABEL.replace(/\./g, "\\.")}"\\s*=>\\s*(disabled|true)`,
    );
    wasOn = !off.test(listing.output ?? "");
    text = fs.read(oldPlist);
  } catch (e) {
    log(`Listener label migration could not start: ${(e as Error).message}`);
    return "rolled-back";
  }

  if (!wasOn) {
    try {
      fs.remove(oldPlist);
      mark();
      log("Listener label migration: the old item was off; removed it");
      return "removed";
    } catch (e) {
      log(`Listener label migration could not remove the old item: ${(e as Error).message}`);
      return "rolled-back";
    }
  }

  const port =
    Number(/<key>COUCH_PORT<\/key>\s*<string>(\d+)<\/string>/.exec(text)?.[1]) || DEFAULT_PORT;
  const oldTarget = `${domain}/${LEGACY_LISTENER_LABEL}`;
  const newTarget = `${domain}/${LISTENER_LABEL}`;
  try {
    const label = /(<key>Label<\/key>\s*<string>)[^<]*(<\/string>)/;
    if (!label.test(text)) throw new Error("the old plist has no Label");
    fs.write(newPlist, text.replace(label, `$1${LISTENER_LABEL}$2`));
    await launchctl("bootout (old)", ["bootout", oldTarget], NOT_LOADED);
    if (!(await waitFor(false, o.freeMs ?? 3000, port)))
      throw new Error(`port ${port} stayed busy after the old job stopped`);
    await launchctl("bootstrap (new)", ["bootstrap", domain, newPlist]);
    await launchctl("kickstart (new)", ["kickstart", newTarget]);
    if (!(await waitFor(true, o.readyMs ?? 5000, port)))
      throw new Error(`the new listener did not answer on port ${port}`);
  } catch (e) {
    log(`Listener label migration failed, rolling back: ${(e as Error).message}`);
    await rollBack();
    return "rolled-back";
  }

  try {
    fs.remove(oldPlist);
    mark();
  } catch (e) {
    log(`Listener label migration: cleanup failed, will retry: ${(e as Error).message}`);
    return "migrated";
  }
  log(`Listener label migrated to ${LISTENER_LABEL}`);
  return "migrated";

  async function rollBack() {
    const step = async (what: string, fn: () => unknown) => {
      try {
        await fn();
      } catch (e) {
        log(`Listener label rollback: ${what} failed: ${(e as Error).message}`);
      }
    };
    await step("boot out the new job", async () => {
      if (await loaded(LISTENER_LABEL))
        await launchctl("bootout (new)", ["bootout", newTarget], NOT_LOADED);
    });
    await step("delete the new plist", () => fs.remove(newPlist));
    await step("restore the old job", async () => {
      if (!(await loaded(LEGACY_LISTENER_LABEL)))
        await launchctl("bootstrap (old)", ["bootstrap", domain, oldPlist]);
      await launchctl("kickstart (old)", ["kickstart", oldTarget]);
    });
  }
}
