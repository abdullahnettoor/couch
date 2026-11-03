import type { AboutPayload, GridItem } from "../../shared/protocol.ts";
import { parseVersion } from "../../shared/semver.ts";
import type { Updates } from "../ports/updates.ts";

const CHECK = "about:check";
const RESTART = "about:restart";
const BETA = "about:beta";
export const RESTART_ID = "restart";
export const NOT_INSTALLED = "Updates only work in the installed Couch.app";

/** What Settings → About asks of the core. */
export interface AboutPageHost {
  updates: Updates;
  ask(title: string, buttons: string[], answers: Array<() => void>, more: { body: string }): void;
  /** Saves what is playing, then Couch quits into the update and opens again. */
  restart(): void;
  toast(text: string): void;
}

/** "0.2.0 (12)": the version and its build number, or the version alone when there is no build number. */
export function versionLabel(u: Pick<Updates, "version" | "build">): string {
  return u.build && u.build !== u.version ? `${u.version} (${u.build})` : u.version;
}

/**
 * Settings → About: the version (a line, not a row focus can land on), Check for updates, Restart to update
 * (only while an update is ready) and Beta updates.
 */
export class AboutPage {
  #h: AboutPageHost;

  constructor(host: AboutPageHost) {
    this.#h = host;
  }

  /** An update has downloaded and installs on a restart. */
  get ready(): boolean {
    return this.#h.updates.state().status === "ready";
  }

  grid(): GridItem[] {
    const rows: Omit<GridItem, "r" | "c">[] = [
      { id: "check", label: "Check for updates", action: CHECK, initial: true },
      ...(this.ready ? [{ id: RESTART_ID, label: "Restart to update", action: RESTART }] : []),
      { id: "beta", label: "Beta updates", action: BETA },
    ];
    return rows.map((row, r) => ({ ...row, r, c: 0 }));
  }

  /** Where Restart to update sits, for Home's update icon. */
  restartCell(): { r: number; c: number } | undefined {
    const row = this.grid().find((i) => i.id === RESTART_ID);
    return row && { r: row.r, c: row.c };
  }

  payload(): AboutPayload {
    const u = this.#h.updates;
    const beta = u.beta();
    const check = checkText(u);
    const hint = u.betaWaits()
      ? `Beta updates ${beta ? "start" : "stop"} next time Couch opens`
      : u.installed && !beta && parseVersion(u.version)?.pre.length
        ? `Couch stays on ${u.version} until a newer version is out`
        : undefined;
    return {
      version: `${versionLabel(u)}${beta ? " · Beta" : ""}`,
      ...(check ? { check } : {}),
      beta,
      ...(hint ? { hint } : {}),
    };
  }

  action(action: string): boolean {
    const u = this.#h.updates;
    switch (action) {
      case CHECK:
        if (u.installed) u.checkNow();
        else this.#h.toast(NOT_INSTALLED);
        return true;
      case RESTART: {
        const s = u.state();
        if (s.status !== "ready") return true;
        this.#h.ask(
          "Restart to update?",
          ["Cancel", "Restart"],
          [() => {}, () => this.#h.restart()],
          {
            body: s.version
              ? `Couch closes and opens again on ${s.version}.`
              : "Couch closes and opens again.",
          },
        );
        return true;
      }
      case BETA:
        u.setBeta(!u.beta());
        return true;
      default:
        return false;
    }
  }
}

function checkText(u: Updates): string | undefined {
  if (!u.installed) return "Only in the installed Couch.app";
  const s = u.state();
  switch (s.status) {
    case "checking":
      return "Checking…";
    case "downloading":
      return s.version ? `Downloading ${s.version}…` : "Downloading…";
    case "ready":
      return s.version ? `${s.version} is ready` : "Update is ready";
    case "up-to-date":
      return "Up to date";
    case "failed":
      return "Couldn't check. Try again later.";
    default:
      return undefined;
  }
}
