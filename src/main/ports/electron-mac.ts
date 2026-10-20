import { execFile, execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { app, dialog, powerSaveBlocker, screen } from "electron";
import type { Mac } from "./mac.ts";

/** Electron-backed Mac port. Volume and display wake arrive with the tickets that need them. */
export function createElectronMac(): Mac {
  let awake: number | undefined;
  let displayAwake: number | undefined;
  const toggle = (
    id: number | undefined,
    keep: boolean,
    type: "prevent-app-suspension" | "prevent-display-sleep",
  ) => {
    if (keep && id === undefined) return powerSaveBlocker.start(type);
    if (!keep && id !== undefined) powerSaveBlocker.stop(id);
    return keep ? id : undefined;
  };
  return {
    getVolume: () =>
      new Promise((resolve) =>
        execFile("osascript", ["-e", "output volume of (get volume settings)"], (err, out) => {
          const n = Number.parseInt(out, 10);
          resolve(err || Number.isNaN(n) ? 0 : n);
        }),
      ),
    setVolume: (percent) =>
      new Promise((resolve) =>
        execFile("osascript", ["-e", `set volume output volume ${Math.round(percent)}`], () =>
          resolve(),
        ),
      ),
    keepAwake(keep) {
      awake = toggle(awake, keep, "prevent-app-suspension");
    },
    keepDisplayAwake(keep) {
      displayAwake = toggle(displayAwake, keep, "prevent-display-sleep");
    },
    wakeDisplay() {},
    listDisplays: () =>
      screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label, internal: d.internal })),
    async pickFolder() {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    localName() {
      try {
        const name = execFileSync("scutil", ["--get", "LocalHostName"], {
          encoding: "utf8",
        }).trim();
        if (name) return `${name}.local`;
      } catch {}
      return `${hostname().replace(/\.local$/, "")}.local`;
    },
    quit: () => app.quit(),
  };
}
