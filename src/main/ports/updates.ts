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
  quitAndInstall(): void;
  on(
    event: "checking-for-update" | "update-available" | "update-not-available",
    listener: () => void,
  ): unknown;
  on(
    event: "update-downloaded",
    listener: (event: unknown, releaseNotes: string, releaseName: string) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** Where an update is: none asked for yet, a check or download under way, or how the last check ended. */
export type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "up-to-date" | "failed";

export interface UpdateState {
  status: UpdateStatus;
  /** The update's version, when known (the beta feed names it; on stable, the release's name once downloaded). */
  version?: string;
}

/** What the core sees of the updater: Settings → About and Home's update icon. */
export interface Updates {
  /** False when Couch runs from the repo (not the installed app): there is nothing to update. */
  readonly installed: boolean;
  /** The app's version, and its macOS build number when it has one. */
  readonly version: string;
  readonly build?: string;
  state(): UpdateState;
  /** The household's Beta updates choice. */
  beta(): boolean;
  /** The Beta updates choice waits for the next start (an update was downloading or ready when it was made). */
  betaWaits(): boolean;
  setBeta(on: boolean): void;
  /** Checks now, unless a check is under way or an update is ready. */
  checkNow(): void;
  /** Quits and opens again on the downloaded update; only when one is ready. */
  restart(): void;
  onChange(listener: () => void): () => void;
}

/** Fetches a JSON document (the beta feed). */
export type FetchJson = (url: string) => Promise<unknown>;

const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
};

const UPDATES_DOC = "updates";

/**
 * The Beta updates choice. Before it was a Setting it was a hidden macOS default (`updateChannel = beta`): with no
 * stored choice, that default is read once and kept, so it moves to the Store and is never read again.
 */
export function readBeta(store: Store, legacyBeta?: () => boolean): boolean {
  const saved = store.read<{ beta?: unknown }>(UPDATES_DOC, {}).beta;
  if (typeof saved === "boolean") return saved;
  if (!legacyBeta?.()) return false;
  store.write(UPDATES_DOC, { beta: true });
  return true;
}

/** The macOS build number (`CFBundleVersion`) in an app's Info.plist text; Electron has no API for it. */
export function bundleBuild(plist: string): string | undefined {
  return (
    /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]?.trim() || undefined
  );
}

/** The first SemVer version in a release's name ("Couch 0.2.1"). */
export function versionIn(name: string | undefined): string | undefined {
  const found = name?.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0];
  return found && parseVersion(found) ? found : undefined;
}

/** The updater in a Couch run from the repo: the version is known, nothing is ever checked or installed. */
export function devUpdates(o: { store: Store; version: string; build?: string }): Updates {
  return {
    installed: false,
    version: o.version,
    ...(o.build ? { build: o.build } : {}),
    state: () => ({ status: "idle" }),
    beta: () => readBeta(o.store),
    betaWaits: () => false,
    setBeta: (on) => o.store.write(UPDATES_DOC, { beta: on }),
    checkNow: () => {},
    restart: () => {},
    onChange: () => () => {},
  };
}

export interface UpdateService extends Updates {
  stop(): void;
}

/**
 * Checks for a newer published release now and then, and when asked. A downloaded update is never forced on the
 * household: macOS installs it when Couch quits (or on Settings → About → Restart to update), and a toast says so
 * once. After that, no more checks until Couch restarts.
 */
export function startUpdates(o: {
  updater: Updater;
  clock: Clock;
  store: Store;
  platform: string;
  arch: string;
  version: string;
  build?: string;
  /** The hidden macOS default Beta updates replaced; read once, only while no choice is stored. */
  legacyBeta?: () => boolean;
  toast: (text: string) => void;
  fetchJson?: FetchJson;
  log?: (message: string) => void;
}): UpdateService {
  const log = o.log ?? ((m) => console.warn(`[couch] ${m}`));
  const listeners = new Set<() => void>();
  let chosen = readBeta(o.store, o.legacyBeta);
  /** The channel Squirrel's feed points at; it lags `chosen` while an update is under way. */
  let feedBeta = chosen;
  let state: UpdateState = { status: "idle" };
  /** The version the beta feed named for the check under way. */
  let offered: string | undefined;
  const set = (next: UpdateState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const busy = () =>
    state.status === "checking" || state.status === "downloading" || state.status === "ready";
  // The beta feed is a plain file that always names an update, and Squirrel.Mac installs whatever its feed
  // names: so on beta Couch reads the file itself and asks Squirrel only when the file's version is newer.
  // Stable never offers an older version: update.electronjs.org answers "no update" unless its newest
  // release is newer than the version in the address, so a beta Mac that leaves beta waits for a newer stable.
  const point = () => {
    feedBeta = chosen;
    o.updater.setFeedURL({ url: feedBeta ? betaFeedUrl(o.arch) : updateFeedUrl(o) });
  };
  point();
  const settle = (next: UpdateState) => {
    set(next);
    // A Beta updates switch made during the check: Squirrel is free again, so point it at the new feed and look.
    if (chosen !== feedBeta) {
      point();
      void check();
    }
  };
  o.updater.on("checking-for-update", () => {
    if (state.status !== "ready") set({ status: "checking" });
  });
  o.updater.on("update-available", () => {
    if (state.status !== "ready")
      set({ status: "downloading", ...(offered ? { version: offered } : {}) });
  });
  o.updater.on("update-not-available", () => {
    if (state.status !== "ready") settle({ status: "up-to-date" });
  });
  o.updater.on("update-downloaded", (_event, _notes, name) => {
    if (state.status === "ready") return;
    const version = offered ?? versionIn(name);
    set({ status: "ready", ...(version ? { version } : {}) });
    o.toast(UPDATE_READY_TOAST);
  });
  // Offline, GitHub down: the row on Settings → About says so; nothing else tells the household.
  o.updater.on("error", (e) => {
    log(`Update check failed: ${e.message}`);
    if (state.status !== "ready") settle({ status: "failed" });
  });
  const newerBeta = async () => {
    const feed = (await (o.fetchJson ?? fetchJson)(betaFeedUrl(o.arch))) as {
      version?: unknown;
    } | null;
    const version = typeof feed?.version === "string" ? feed.version : "";
    if (!parseVersion(version)) throw new Error("the beta feed names no version");
    return compareVersions(version, o.version) > 0 ? version : undefined;
  };
  const check = async () => {
    if (busy()) return;
    offered = undefined;
    set({ status: "checking" });
    try {
      if (feedBeta) {
        offered = await newerBeta();
        if (!offered) return settle({ status: "up-to-date" });
      }
      o.updater.checkForUpdates();
    } catch (e) {
      log(`Update check failed: ${(e as Error).message}`);
      settle({ status: "failed" });
    }
  };
  const cancels = [
    o.clock.setTimeout(() => {
      void check();
      cancels.push(o.clock.setInterval(() => void check(), CHECK_EVERY_MS));
    }, FIRST_CHECK_MS),
  ];
  return {
    installed: true,
    version: o.version,
    ...(o.build ? { build: o.build } : {}),
    state: () => ({ ...state }),
    beta: () => chosen,
    betaWaits: () =>
      chosen !== feedBeta && (state.status === "downloading" || state.status === "ready"),
    setBeta(on) {
      if (on === chosen) return;
      chosen = on;
      o.store.write(UPDATES_DOC, { beta: on });
      // Squirrel's feed can't change under a check or a download (a new feed is a new Squirrel updater, which
      // knows nothing of the update the old one fetched): then it waits for the check to end, or the next start.
      if (busy()) return set(state);
      point();
      void check();
    },
    checkNow: () => void check(),
    restart() {
      if (state.status === "ready") o.updater.quitAndInstall();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop: () => cancels.forEach((cancel) => cancel()),
  };
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
