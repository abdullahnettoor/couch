import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { Channel, type GridReport } from "../shared/ipc.ts";
import type { Command } from "../shared/protocol.ts";
import type { PlayerEvent } from "../shared/player.ts";
import { startApp, type CouchApp } from "./app.ts";
import { pickTargetDisplay } from "./display.ts";
import { systemClock } from "./ports/clock.ts";
import { createElectronMac } from "./ports/electron-mac.ts";
import { nullYouTube } from "./ports/null-youtube.ts";
import { findMpv } from "./mpv/find-mpv.ts";
import { MpvPlayer } from "./mpv/mpv-player.ts";

const REMOTE_PORT = Number(process.env.COUCH_PORT ?? 4747);

// Fixed name so app data lives in ~/Library/Application Support/Couch whichever way Couch is launched.
app.setName("Couch");

let win: BrowserWindow | undefined;
let player: MpvPlayer | undefined;
let couch: CouchApp | undefined;
let mpvMissing = false;
let mpvMessage: string | undefined;

function publishMpv(): void {
  if (win && !win.isDestroyed())
    win.webContents.send(Channel.mpv, { missing: mpvMissing, message: mpvMessage });
}

function publishScreen(): void {
  if (couch && win && !win.isDestroyed()) win.webContents.send(Channel.screen, couch.core.screen());
}

/** Bring the Screen back in front, with keyboard focus, after mpv's window goes away. */
function reclaimScreen(): void {
  if (!win) return;
  win.show();
  app.focus({ steal: true });
  win.focus();
  win.webContents.focus();
}

function onPlayerEvent(event: PlayerEvent): void {
  switch (event.type) {
    case "missing":
      mpvMissing = true;
      break;
    case "exited":
      mpvMessage = "mpv stopped unexpectedly";
      reclaimScreen();
      break;
    case "ended":
      reclaimScreen();
      break;
    default:
      return;
  }
  publishMpv();
}

async function createScreen(): Promise<void> {
  const displays = screen.getAllDisplays();
  const target = pickTargetDisplay(
    displays.map((d) => ({ id: d.id, label: d.label, internal: d.internal })),
  );
  const display = displays.find((d) => d.id === target?.id) ?? screen.getPrimaryDisplay();

  win = new BrowserWindow({
    ...display.bounds,
    backgroundColor: "#000000",
    show: false,
    frame: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => {
    win?.show();
    win?.setSimpleFullScreen(true);
  });
  win.webContents.on("did-finish-load", () => {
    publishMpv();
    publishScreen();
  });
  await win.loadFile(join(import.meta.dirname, "../renderer/index.html"));

  player = new MpvPlayer({
    mpvPath: process.env.COUCH_FORCE_NO_MPV ? undefined : findMpv(),
    screenName: display.label || undefined,
  });
  player.onEvent(onPlayerEvent);
  await player.start();
  const mac = createElectronMac();
  mac.keepAwake(true);
  couch = await startApp({
    player,
    youtube: nullYouTube,
    mac,
    clock: systemClock,
    port: REMOTE_PORT,
  });
  couch.onScreen(publishScreen);
  publishScreen();
}

ipcMain.on(Channel.command, (_event, command: Command) => couch?.screenCommand(command));
ipcMain.on(Channel.grid, (_event, report: GridReport) =>
  couch?.reportGrid(report.viewKey, report.items),
);

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !player) return;
  event.preventDefault();
  quitting = true;
  void Promise.all([player.dispose(), couch?.stop()]).finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());

void app.whenReady().then(createScreen);
