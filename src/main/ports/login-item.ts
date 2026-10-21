import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LISTENER_LABEL = "local.couch.listener";

export interface ListenerLoginItem {
  /** False outside an installed Couch.app (development). */
  available: boolean;
  on: boolean;
}

export type Exec = (file: string, args: string[]) => Promise<{ ok: boolean }>;

export const systemExec: Exec = (file, args) =>
  new Promise((resolve) => execFile(file, args, (error) => resolve({ ok: !error })));

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The LaunchAgent that keeps the listener running from login. */
export function listenerPlist(o: {
  label: string;
  program: string;
  launch: string;
  log: string;
}): string {
  const args = [o.program, "--launch", o.launch].map((a) => `    <string>${xml(a)}</string>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(o.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(o.log)}</string>
</dict>
</plist>
`;
}

export interface LoginItemOptions {
  /** Where `Library/LaunchAgents` and `Library/Logs` live. */
  home: string;
  uid: number;
  /** The listener binary inside the running app's bundle; undefined when not packaged. */
  program: string | undefined;
  /** Shell command that starts Couch, e.g. `open -a '/Applications/Couch.app'`. */
  launch: string;
  label?: string;
  exec?: Exec;
}

/** Turns the listener's LaunchAgent on and off with launchctl. */
export function createLoginItem(o: LoginItemOptions) {
  const label = o.label ?? LISTENER_LABEL;
  const exec = o.exec ?? systemExec;
  const plist = join(o.home, "Library", "LaunchAgents", `${label}.plist`);
  const log = join(o.home, "Library", "Logs", "Couch", "listener.log");
  const domain = `gui/${o.uid}`;
  return {
    plistPath: plist,
    async state(): Promise<ListenerLoginItem> {
      if (!o.program) return { available: false, on: false };
      return { available: true, on: (await exec("launchctl", ["print", `${domain}/${label}`])).ok };
    },
    async set(on: boolean): Promise<void> {
      if (!o.program) return;
      if (on) {
        mkdirSync(dirname(plist), { recursive: true });
        mkdirSync(dirname(log), { recursive: true });
        writeFileSync(plist, listenerPlist({ label, program: o.program, launch: o.launch, log }));
        await exec("launchctl", ["bootout", `${domain}/${label}`]);
        await exec("launchctl", ["bootstrap", domain, plist]);
      } else {
        await exec("launchctl", ["bootout", `${domain}/${label}`]);
        rmSync(plist, { force: true });
      }
    },
  };
}
