import { compareVersions, parseVersion } from "../../shared/semver.ts";
import type { Clock } from "./clock.ts";
import { LISTENER_LABEL, systemExec, type Exec } from "./login-item.ts";
import type { Store } from "./store.ts";

/** The GitHub repo whose published Releases update.electronjs.org serves as updates. */
export const UPDATE_REPO = "abdullahnettoor/couch";
export const UPDATE_READY_TOAST = "Couch has an update. It's ready next time Couch opens.";
/** Not during start-up: the first check waits a minute, then one every six hours. */
export const FIRST_CHECK_MS = 60_000;
export const CHECK_EVERY_MS = 6 * 60 * 60_000;

/**
 * Stable follows update.electronjs.org, which serves only published releases that aren't pre-releases. Beta
 * follows the beta feed (scripts/beta-feed.mjs), which names the newest published release, beta or stable.
 */
export type UpdateChannel = "stable" | "beta";

export const updateFeedUrl = (o: { platform: string; arch: string; version: string }) =>
  `https://update.electronjs.org/${UPDATE_REPO}/${o.platform}-${o.arch}/${o.version}`;

export const betaFeedUrl = (arch: string) =>
  `https://github.com/${UPDATE_REPO}/releases/download/beta-feed/beta-darwin-${arch}.json`;

/** The part of Electron's autoUpdater Couch uses. */
export interface Updater {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  on(event: "update-downloaded", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** Fetches a JSON document (the beta feed). */
export type FetchJson = (url: string) => Promise<unknown>;

const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
};

/**
 * Checks for a newer published release now and then. A downloaded update is never forced on the household: macOS
 * installs it when Couch quits, and a toast says so once. After that, no more checks until Couch restarts.
 */
export function startUpdates(o: {
  updater: Updater;
  clock: Clock;
  platform: string;
  arch: string;
  version: string;
  channel?: UpdateChannel;
  toast: (text: string) => void;
  fetchJson?: FetchJson;
  log?: (message: string) => void;
}): () => void {
  const log = o.log ?? ((m) => console.warn(`[couch] ${m}`));
  const beta = o.channel === "beta";
  // The beta feed is a plain file that always names an update, and Squirrel.Mac installs whatever its feed
  // names: so on beta Couch reads the file itself and asks Squirrel only when the file's version is newer.
  o.updater.setFeedURL({ url: beta ? betaFeedUrl(o.arch) : updateFeedUrl(o) });
  let downloaded = false;
  o.updater.on("update-downloaded", () => {
    if (downloaded) return;
    downloaded = true;
    o.toast(UPDATE_READY_TOAST);
  });
  // Offline, GitHub down, or no newer release: nothing to tell the household.
  o.updater.on("error", (e) => log(`Update check failed: ${e.message}`));
  const newerBeta = async () => {
    const feed = (await (o.fetchJson ?? fetchJson)(betaFeedUrl(o.arch))) as {
      version?: unknown;
    } | null;
    const version = typeof feed?.version === "string" ? feed.version : "";
    if (!parseVersion(version)) throw new Error("the beta feed names no version");
    return compareVersions(version, o.version) > 0;
  };
  const check = async () => {
    if (downloaded) return;
    try {
      if (beta && !(await newerBeta())) return;
      o.updater.checkForUpdates();
    } catch (e) {
      log(`Update check failed: ${(e as Error).message}`);
    }
  };
  const cancels = [
    o.clock.setTimeout(() => {
      void check();
      cancels.push(o.clock.setInterval(() => void check(), CHECK_EVERY_MS));
    }, FIRST_CHECK_MS),
  ];
  return () => cancels.forEach((cancel) => cancel());
}

const LISTENER_VERSION_DOC = "listener-version";

/**
 * After an update the Listener's LaunchAgent still runs the previous version's binary (it was running when the
 * app bundle was replaced). On the first start of a new version, restart it so the new one runs.
 */
export async function restartListenerAfterUpdate(o: {
  store: Store;
  version: string;
  uid: number;
  /** True when the Listener's LaunchAgent is loaded. */
  listenerOn: () => Promise<boolean>;
  exec?: Exec;
}): Promise<"restarted" | "unchanged" | "off"> {
  const last = o.store.read<{ version?: string }>(LISTENER_VERSION_DOC, {}).version;
  if (last === o.version) return "unchanged";
  if (!(await o.listenerOn())) {
    o.store.write(LISTENER_VERSION_DOC, { version: o.version });
    return "off";
  }
  const exec = o.exec ?? systemExec;
  const r = await exec("launchctl", ["kickstart", "-k", `gui/${o.uid}/${LISTENER_LABEL}`]);
  if (!r.ok) throw new Error(`launchctl kickstart failed (exit ${r.code ?? "none"})`);
  o.store.write(LISTENER_VERSION_DOC, { version: o.version });
  return "restarted";
}
