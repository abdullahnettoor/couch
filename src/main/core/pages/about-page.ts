import { VIEW_LABELS, type GridItem, type ScreenPayload } from "../../../shared/protocol.ts";
import { SUPPORT_URL, SUPPORT_URL_SHORT } from "../../../shared/links.ts";
import { parseVersion } from "../../../shared/semver.ts";
import type { Updates } from "../../ports/updates.ts";
import type { Page, PageBack, PageContext } from "./page.ts";

const CHECK = "about:check";
const RESTART = "about:restart";
const BETA = "about:beta";
const SETUP = "about:setup";
const SUPPORT = "about:support";
const SUPPORT_CLOSE = "about:support-close";
export const SUPPORT_LABEL = "Support Couch";
export const SUPPORT_LINE =
  "Couch is free and open source. If it's earned a place on your TV, you can buy me a coffee.";
export const RESTART_ID = "restart";
export const NOT_INSTALLED = "Updates only work in the installed Couch.app";

/** What Settings → About asks of the core, besides the Page context. */
export interface AboutPageHost {
  updates: Updates;
  /** Saves what is playing, then Couch quits into the update and opens again. */
  restart(): void;
  /** Goes Home and opens the full Setup again. */
  runSetup(): void;
}

/** "0.2.0 (12)": the version and its build number, or the version alone when there is no build number. */
export function versionLabel(u: Pick<Updates, "version" | "build">): string {
  return u.build && u.build !== u.version ? `${u.version} (${u.build})` : u.version;
}

/**
 * Settings → About: the version (a line, not a row focus can land on), Check for updates, Restart to update
 * (only while an update is ready), Beta updates, Run setup again and Support Couch, whose OK opens a panel
 * with a QR code over the page (Back or Close shuts it).
 */
export class AboutPage implements Page {
  #ctx: PageContext;
  #h: AboutPageHost;
  #supportOpen = false;

  constructor(ctx: PageContext, host: AboutPageHost) {
    this.#ctx = ctx;
    this.#h = host;
  }

  back(): PageBack {
    if (this.#supportOpen) return { act: () => this.#closeSupport() };
    return { label: VIEW_LABELS.settings, act: () => this.#ctx.go("settings") };
  }

  /** An update has downloaded and installs on a restart. */
  get ready(): boolean {
    return this.#h.updates.state().status === "ready";
  }

  /** The panel has its own focus (Close), so the page keeps its own while the panel is up. */
  focusKey(): string | undefined {
    return this.#supportOpen ? "about:support" : undefined;
  }

  leave(): void {
    this.#supportOpen = false;
  }

  /** Shuts the panel and puts focus back on the Support Couch row. */
  #closeSupport(): void {
    this.#supportOpen = false;
    this.#ctx.emit();
  }

  grid(): GridItem[] {
    if (this.#supportOpen)
      return [
        { id: "support-close", label: "Close", action: SUPPORT_CLOSE, r: 0, c: 0, initial: true },
      ];
    const rows: Omit<GridItem, "r" | "c">[] = [
      { id: "check", label: "Check for updates", action: CHECK, initial: true },
      ...(this.ready ? [{ id: RESTART_ID, label: "Restart to update", action: RESTART }] : []),
      { id: "beta", label: "Beta updates", action: BETA },
      { id: "setup", label: "Run setup again", action: SETUP },
      { id: "support", label: SUPPORT_LABEL, action: SUPPORT },
    ];
    return rows.map((row, r) => ({ ...row, r, c: 0 }));
  }

  /** Where Restart to update sits, for Home's update icon. */
  restartCell(): { r: number; c: number } | undefined {
    const row = this.grid().find((i) => i.id === RESTART_ID);
    return row && { r: row.r, c: row.c };
  }

  payload(): Pick<ScreenPayload, "about"> {
    const u = this.#h.updates;
    const beta = u.beta();
    const check = checkText(u);
    const hint = u.betaWaits()
      ? `Beta updates ${beta ? "start" : "stop"} next time Couch opens`
      : u.installed && !beta && parseVersion(u.version)?.pre.length
        ? `Couch stays on ${u.version} until a newer version is out`
        : undefined;
    return {
      about: {
        version: `${versionLabel(u)}${beta ? " · Beta" : ""}`,
        ...(check ? { check } : {}),
        beta,
        ...(hint ? { hint } : {}),
        support: {
          line: SUPPORT_LINE,
          url: SUPPORT_URL,
          short: SUPPORT_URL_SHORT,
          open: this.#supportOpen,
        },
      },
    };
  }

  action(action: string): boolean {
    const u = this.#h.updates;
    switch (action) {
      case CHECK:
        if (u.installed) u.checkNow();
        else this.#ctx.toast(NOT_INSTALLED);
        return true;
      case RESTART: {
        const s = u.state();
        if (s.status !== "ready") return true;
        this.#ctx.ask(
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
      case SETUP:
        this.#h.runSetup();
        return true;
      case SUPPORT:
        this.#supportOpen = true;
        this.#ctx.emit();
        return true;
      case SUPPORT_CLOSE:
        this.#closeSupport();
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
