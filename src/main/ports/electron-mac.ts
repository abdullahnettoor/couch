import { execFile, execFileSync, spawn } from "node:child_process";
import { hostname } from "node:os";
import { app, BrowserWindow, dialog, powerSaveBlocker, screen, systemPreferences } from "electron";
import type { Mac } from "./mac.ts";

function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script], (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()),
    ),
  );
}

/** Electron-backed Mac port. Display wake arrives with the ticket that needs it. */
export function createElectronMac(
  getWindow: () => BrowserWindow | undefined = () => undefined,
): Mac {
  let lastWake = 0;
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
      osascript("output volume of (get volume settings)").then((out) => Number(out) || 0),
    setVolume: (percent) =>
      osascript(`set volume output volume ${Math.round(Math.max(0, Math.min(100, percent)))}`).then(
        () => {},
      ),
    keepAwake(keep) {
      awake = toggle(awake, keep, "prevent-app-suspension");
    },
    keepDisplayAwake(keep) {
      displayAwake = toggle(displayAwake, keep, "prevent-display-sleep");
    },
    wakeDisplay() {
      const now = Date.now();
      if (now - lastWake < 5000) return;
      lastWake = now;
      try {
        spawn("caffeinate", ["-u", "-t", "2"], { stdio: "ignore", detached: true }).unref();
      } catch {}
    },
    onDisplaysChanged(listener) {
      screen.on("display-added", listener);
      screen.on("display-removed", listener);
      screen.on("display-metrics-changed", listener);
      return () => {
        screen.removeListener("display-added", listener);
        screen.removeListener("display-removed", listener);
        screen.removeListener("display-metrics-changed", listener);
      };
    },
    moveScreenTo(displayId) {
      const win = getWindow();
      const display = screen.getAllDisplays().find((d) => d.id === displayId);
      if (!win || win.isDestroyed() || !display) return;
      // Native full screen can't be moved: leave it, move, then come back (only if it was on).
      if (!win.isFullScreen()) return win.setBounds(display.bounds);
      win.once("leave-full-screen", () => {
        win.setBounds(display.bounds);
        win.setFullScreen(true);
      });
      win.setFullScreen(false);
    },
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
    timeFormat() {
      try {
        if (systemPreferences.getUserDefault("AppleICUForce24HourTime", "boolean")) return "24";
        if (systemPreferences.getUserDefault("AppleICUForce12HourTime", "boolean")) return "12";
      } catch {}
      const cycle = new Intl.DateTimeFormat().resolvedOptions().hourCycle;
      return cycle === "h23" || cycle === "h24" ? "24" : "12";
    },
    onTimeFormatChanged(listener) {
      try {
        const id = systemPreferences.subscribeNotification(
          "AppleTimePreferencesChangedNotification",
          listener,
        );
        return () => systemPreferences.unsubscribeNotification(id);
      } catch {
        return () => {};
      }
    },
    quit: () => app.quit(),
  };
}
