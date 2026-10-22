import { app, BrowserWindow, ipcMain, Menu, screen } from "electron";
import { join } from "node:path";
import { Channel, type GlassRect, type GridReport } from "../shared/ipc.ts";
import type { Command } from "../shared/protocol.ts";
import type { PlayerEvent } from "../shared/player.ts";
import { startApp, type CouchApp } from "./app.ts";
import { pickTargetDisplay } from "./display.ts";
import { revealScreen } from "./reveal.ts";
import { systemClock } from "./ports/clock.ts";
import { createElectronMac } from "./ports/electron-mac.ts";
import { ElectronWebApp } from "./web/electron-web-app.ts";
import { youtubeDescription } from "./apps/youtube/youtube-web.ts";
import { netflixDescription } from "./apps/netflix/netflix-web.ts";
import { NetflixApp } from "./apps/netflix/netflix-app.ts";
import { YouTubeApp } from "./apps/youtube/youtube-app.ts";
import { IdleUnloader } from "./web/idle-unload.ts";
import { FileStore } from "./ports/store.ts";
import { readChoices } from "./web/addon.ts";
import { FfmpegThumbnails } from "./ports/thumbnails.ts";
import { TmdbMetadata } from "./ports/tmdb-metadata.ts";
import { PROJECT_TMDB_KEY } from "./ports/project-key.ts";
import { detectListener } from "./frontdoor.ts";
import { chooseBinding } from "./listener.ts";
import { createEmbedFactory } from "./mpv/embed-addon.ts";
import { MpvPlayer } from "./mpv/mpv-player.ts";

// Fixed name so app data lives in ~/Library/Application Support/Couch whichever way Couch is launched.
app.setName("Couch");

let win: BrowserWindow | undefined;
let player: MpvPlayer | undefined;
let couch: CouchApp | undefined;
let mpvMissing = false;
let mpvMessage: string | undefined;

function publishMpv(): void {
  if (win && !win.isDestroyed())
    win.webContents.send(Channel.mpv, {
      missing: mpvMissing,
      message: mpvMessage,
      nativeGlass: player?.nativeGlass === true,
    });
}

function publishScreen(): void {
  if (couch && win && !win.isDestroyed()) win.webContents.send(Channel.screen, couch.screen());
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
  const choices = displays.map((d) => ({ id: d.id, label: d.label, internal: d.internal }));
  // COUCH_DISPLAY=internal pins Couch to the built-in screen (testing while a TV or monitor is in use).
  const target =
    process.env.COUCH_DISPLAY === "internal"
      ? (choices.find((d) => d.internal) ?? pickTargetDisplay(choices))
      : pickTargetDisplay(choices);
  const display = displays.find((d) => d.id === target?.id) ?? screen.getPrimaryDisplay();

  win = new BrowserWindow({
    ...display.bounds,
    title: "Couch",
    // Transparent so the video under the web contents shows through while a video plays.
    transparent: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => {
    win?.show();
    // Native full screen in its own Space, with traffic lights on hover; the video is drawn inside this window.
    win?.setFullScreen(true);
  });
  const syncChrome = (): void => {
    const fullScreen = win?.isFullScreen() ?? false;
    void win?.webContents.executeJavaScript(
      `document.body.classList.toggle("windowed", ${!fullScreen})`,
    );
  };
  win.on("enter-full-screen", syncChrome);
  win.on("leave-full-screen", syncChrome);
  win.webContents.on("did-finish-load", () => {
    syncChrome();
    publishMpv();
    publishScreen();
  });
  await win.loadFile(join(import.meta.dirname, "../renderer/index.html"));

  player = new MpvPlayer({
    mpvPath: undefined,
    embed: process.env.COUCH_FORCE_NO_MPV ? undefined : createEmbedFactory(() => win),
    // Bring Couch (and its full-screen Space) forward so the video is seen.
    beforeLoad: () => (win ? revealScreen(win) : Promise.resolve()),
  });
  player.onEvent(onPlayerEvent);
  await player.start();
  publishMpv();
  // Fallback tint: the video's main colour, about once a second (only when native glass is off).
  setInterval(() => {
    if (player?.nativeGlass || !win || win.isDestroyed()) return;
    win.webContents.send(Channel.tint, player?.videoColor() ?? null);
  }, 1000).unref();
  const mac = createElectronMac(() => win, {
    list: () => player!.listAudioDevices(),
    onChanged: (listener) => player!.onAudioDevicesChanged(listener),
  });
  const store = new FileStore(app.getPath("userData"));
  const unloader = new IdleUnloader(systemClock, store);
  const youtube = new ElectronWebApp(
    youtubeDescription(app.getVersion(), process.env, readChoices(store, "youtube")),
    win,
    unloader.track("youtube", () => youtube.unload(), { loaded: true }),
  );
  const youtubeApp = new YouTubeApp(youtube, systemClock);
  const netflix = new ElectronWebApp(
    netflixDescription(),
    win,
    unloader.track("netflix", () => netflix.unload()),
  );
  const netflixApp = new NetflixApp(netflix, systemClock);
  mac.keepAwake(true);
  const listener = await detectListener({
    store,
    installed: async () => (await mac.listenerLoginItem()).on,
  });
  couch = await startApp({
    player,
    apps: [youtubeApp, netflixApp],
    mac,
    clock: systemClock,
    store,
    thumbnails: new FfmpegThumbnails(join(app.getPath("userData"), "thumbnails")),
    thumbnailDir: join(app.getPath("userData"), "thumbnails"),
    iconDir: join(import.meta.dirname, "../renderer"),
    metadata: new TmdbMetadata(join(app.getPath("userData"), "thumbnails")),
    tmdbProjectKey: PROJECT_TMDB_KEY,
    ...chooseBinding(listener, process.env),
    frontdoorSetup: { env: process.env },
    listener: listener && { publicPort: listener.publicPort, token: listener.token },
  });
  couch.onScreen(publishScreen);
  youtube.start();
  publishScreen();
}

ipcMain.on(Channel.command, (_event, command: Command) => couch?.screenCommand(command));
ipcMain.on(Channel.grid, (_event, report: GridReport) =>
  couch?.reportGrid(report.viewKey, report.items),
);

ipcMain.on(Channel.glass, (_event, rects: GlassRect[]) => player?.setGlass(rects));

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !player) return;
  event.preventDefault();
  quitting = true;
  couch?.beforeQuit();
  void Promise.all([player.dispose(), couch?.stop()]).finally(() => app.quit());
});

// Only Couch's own ⌘Q asks; every other quit (log out, shut down, Dock → Quit) goes straight through.
function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { label: `Quit ${app.name}`, accelerator: "CmdOrCtrl+Q", click: () => couch?.askQuit() },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
}

app.on("window-all-closed", () => app.quit());

void app.whenReady().then(() => {
  installMenu();
  return createScreen();
});
