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
    getVolume: () => Promise.resolve(0),
    setVolume: () => Promise.resolve(),
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
    quit: () => app.quit(),
  };
}
