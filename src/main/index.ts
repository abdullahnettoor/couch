import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { Channel, type ScreenCommand, type ScreenStatus } from "../shared/ipc.ts";
import type { PlayerEvent } from "../shared/player.ts";
import { pickTargetDisplay } from "./display.ts";
import { findMpv } from "./mpv/find-mpv.ts";
import { MpvPlayer } from "./mpv/mpv-player.ts";

// Temporary (ticket 002): the real core and Remote arrive in later tickets.
const SAMPLE = process.env.COUCH_SAMPLE ?? join(app.getAppPath(), ".dev", "sample.mkv");

let win: BrowserWindow | undefined;
let player: MpvPlayer | undefined;
const status: ScreenStatus = { mpvMissing: false, playing: false, paused: false, position: 0 };

function publish(): void {
  win?.webContents.send(Channel.status, status);
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
      status.mpvMissing = true;
      break;
    case "exited":
      status.message = "mpv stopped unexpectedly";
      status.playing = false;
      reclaimScreen();
      break;
    case "position":
      status.position = event.seconds;
      break;
    case "pause":
      status.paused = event.paused;
      break;
    case "ended":
      status.playing = false;
      status.paused = false;
      reclaimScreen();
      break;
    case "duration":
      return;
  }
  publish();
}

async function handleCommand(command: ScreenCommand): Promise<void> {
  if (command === "quit") return app.quit();
  if (!player || status.mpvMissing) return;
  try {
    switch (command) {
      case "play":
        status.playing = true;
        publish();
        await player.load(SAMPLE);
        break;
      case "togglePause":
        await player.setPaused(!status.paused);
        break;
      case "seekBack":
        await player.seekBy(-10);
        break;
      case "seekForward":
        await player.seekBy(10);
        break;
      case "stop":
        await player.stop();
        break;
    }
  } catch (error) {
    console.error("player command failed", command, error);
  }
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
  win.webContents.on("did-finish-load", publish);
  await win.loadFile(join(import.meta.dirname, "../renderer/index.html"));

  player = new MpvPlayer({
    mpvPath: process.env.COUCH_FORCE_NO_MPV ? undefined : findMpv(),
    screenName: display.label || undefined,
  });
  player.onEvent(onPlayerEvent);
  await player.start();
  if (process.env.COUCH_SELFTEST) void selfTest();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dev aid (COUCH_SELFTEST=1): play/stop and play-to-end five times, logging window state. */
async function selfTest(): Promise<void> {
  const log = (what: string) =>
    console.log(
      `[selftest] ${what}: focused=${win?.isFocused()} visible=${win?.isVisible()} simpleFS=${win?.isSimpleFullScreen()} bounds=${JSON.stringify(win?.getBounds())}`,
    );
  await sleep(1500);
  log("start");
  if (process.env.COUCH_SELFTEST === "quit-mid-play") {
    await handleCommand("play");
    await sleep(2500);
    return app.quit();
  }
  for (let i = 1; i <= 5; i++) {
    await handleCommand("play");
    await sleep(2500);
    if (i % 2 === 1) {
      await handleCommand("stop");
    } else {
      await player?.seekTo(19);
      await sleep(2500);
    }
    await sleep(700);
    log(`round ${i} after ${i % 2 === 1 ? "stop" : "eof"}`);
  }
  app.quit();
}

ipcMain.on(Channel.command, (_event, command: ScreenCommand) => void handleCommand(command));

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !player) return;
  event.preventDefault();
  quitting = true;
  void player.dispose().finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());

void app.whenReady().then(createScreen);
