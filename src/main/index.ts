import { app, BrowserWindow, dialog, ipcMain, Menu, screen, WebContentsView } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { screenPointer } from "./pointer-position.ts";
import { Channel, type GlassRect, type GridReport } from "../shared/ipc.ts";
import type { Command } from "../shared/protocol.ts";
import type { PlayerEvent } from "../shared/player.ts";
import { startApp, type CouchApp } from "./app.ts";
import { pickTargetDisplay } from "./display.ts";
import { revealScreen } from "./reveal.ts";
import { systemClock } from "./ports/clock.ts";
import { createElectronMac } from "./ports/electron-mac.ts";
import { ElectronWebApp } from "./web/electron-web-app.ts";
import { resolveWebKitStore } from "./web/webkit-stores.ts";
import { createSafariSignIn, safariCookiePaths } from "./web/safari-sign-in.ts";
import { WebKitWebApp } from "./web/webkit-web-app.ts";
import {
  ensureTestClip,
  serveTestPage,
  testPageDescription,
  testPageEnabled,
  type TestPageServer,
} from "./web/webkit-test-page.ts";
import { NATIVE_APP_CLASS, nativeAppFront, netflixEngine } from "./web/native-front.ts";
import { youtubeDescription } from "./apps/youtube/youtube-web.ts";
import { netflixDescription } from "./apps/netflix/netflix-web.ts";
import { NetflixApp } from "./apps/netflix/netflix-app.ts";
import { YouTubeApp } from "./apps/youtube/youtube-app.ts";
import { APP_ENTRIES } from "./apps/index.ts";
import { resolveHomeApps } from "./core/home-apps.ts";
import { IdleUnloader } from "./web/idle-unload.ts";
import { FileStore } from "./ports/store.ts";
import { readChoices } from "./web/addon.ts";
import { FfmpegThumbnails, findFfmpeg } from "./ports/thumbnails.ts";
import { ElectronConverter } from "./ports/electron-pictures.ts";
import { RealMacWallpapers } from "./ports/mac-wallpapers.ts";
import { WallpaperFilesOnDisk } from "./ports/pictures.ts";
import { TmdbMetadata } from "./ports/tmdb-metadata.ts";
import { PROJECT_TMDB_KEY } from "./ports/project-key.ts";
import { detectListener } from "./frontdoor.ts";
import { chooseBinding } from "./listener.ts";
import {
  createDrawerGlass,
  createEmbedFactory,
  createWebKitBridge,
  disposeNativeWindow,
  setCursorHidden,
  watchMouseMoves,
} from "./mpv/embed-addon.ts";
import { CursorHider } from "./cursor-hider.ts";
import { wireCursor, wireTeardown, type CursorHost } from "./cursor-lifecycle.ts";
import { PictureCover } from "./web/picture-cover.ts";
import { QuickDrawer } from "./web/quick-drawer.ts";
import { EdgeGesture } from "./quick-edge.ts";
import { MouseMoves } from "./mouse-moves.ts";
import { wireQuickIpc } from "./quick-ipc.ts";
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
  // Developer flag COUCH_NETFLIX_ENGINE=webkit: Netflix in a native WKWebView under the window's web contents (FairPlay).
  const webkitBridge =
    process.env.COUCH_NETFLIX_ENGINE === "webkit" ? createWebKitBridge(() => win) : undefined;
  const engine = netflixEngine(process.env, webkitBridge !== undefined);
  if (process.env.COUCH_NETFLIX_ENGINE === "webkit" && engine !== "webkit")
    console.warn("[netflix] WebKit is not available here; using Chromium");
  const nativeApps = new Set<string>(engine === "webkit" ? ["netflix"] : []);
  const testPage = engine === "webkit" ? await startTestPage() : undefined;
  const netflix =
    engine === "webkit"
      ? new WebKitWebApp(
          testPage
            ? testPageDescription(netflixDescription(), testPage.origin)
            : netflixDescription(),
          webkitBridge!,
          {
            getContentBounds: () => win!.getContentBounds(),
            onResize: (callback) => win!.on("resize", callback),
            reveal: () => revealScreen(win!),
          },
          resolveWebKitStore("netflix", { userDataDir: app.getPath("userData"), env: process.env }),
          unloader.track("netflix", () => netflix.unload()),
        )
      : new ElectronWebApp(
          netflixDescription(),
          win,
          unloader.track("netflix", () => netflix.unload()),
        );
  const netflixApp = new NetflixApp(
    netflix,
    systemClock,
    netflix instanceof WebKitWebApp
      ? createSafariSignIn({
          paths: safariCookiePaths(app.getPath("home")),
          read: (path) => readFile(path),
          target: netflix,
        })
      : undefined,
  );
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
    wallpapers: {
      mac: new RealMacWallpapers(app.getPath("home"), async (current) => {
        const picked = await dialog.showOpenDialog(win!, {
          title: "Wallpaper folder",
          defaultPath: current,
          properties: ["openDirectory"],
        });
        return picked.canceled ? undefined : picked.filePaths[0];
      }),
      converter: new ElectronConverter(join(app.getPath("userData"), "wallpapers")),
      files: new WallpaperFilesOnDisk(join(app.getPath("userData"), "wallpapers")),
    },
    thumbnailDir: join(app.getPath("userData"), "thumbnails"),
    iconDir: join(import.meta.dirname, "../renderer"),
    metadata: new TmdbMetadata(join(app.getPath("userData"), "thumbnails")),
    tmdbProjectKey: PROJECT_TMDB_KEY,
    ...chooseBinding(listener, process.env),
    frontdoorSetup: { env: process.env },
    listener: listener && { publicPort: listener.publicPort, token: listener.token },
  });
  const cover = new PictureCover<WebContentsView>(
    win,
    () => new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } }),
    (command) => couch?.screenCommand(command),
    (event, input) => drawer.intercept(event, input),
  );
  const webs: Record<string, { focus(): void }> = { youtube, netflix };
  let front: { view: string; app?: string } = { view: "home" };
  const drawer = new QuickDrawer<WebContentsView>(
    win,
    () =>
      new WebContentsView({
        webPreferences: {
          preload: join(import.meta.dirname, "../preload/quick.cjs"),
          sandbox: true,
          contextIsolation: true,
        },
      }),
    (command) => couch?.screenCommand(command),
    systemClock,
    () => {
      if (front.view === "app" && front.app && webs[front.app]) webs[front.app]!.focus();
      else win?.webContents.focus();
    },
    // Off, and it stays off: Chromium's compositor view draws every web view (the drawer's page too), so no native glass can sit
    // under the drawer's rows (ticket 104). With =1 the keeper refuses to place it and the drawer is left untinted: experiments only.
    process.env.COUCH_DRAWER_GLASS === "1" ? createDrawerGlass(() => win) : undefined,
  );
  win.on("resize", () => {
    cover.fit();
    drawer.fit();
  });
  for (const web of [youtube, netflix])
    web.setKeyGate((e, i) => drawer.intercept(e, i) || cover.intercept(e, i));
  // One native mouse-moved subscription (starting a second would replace the first), shared by the cursor and the edge gesture.
  const moves = new MouseMoves(watchMouseMoves);
  const cursor = new CursorHider({
    clock: systemClock,
    onMouseMoved: moves.subscribe,
    setHidden: setCursorHidden,
  });
  // The pointer resting at the far right edge opens Quick settings; the gesture only arms on real movement.
  const edge = new EdgeGesture({
    clock: systemClock,
    onMouseMoved: moves.subscribe,
    position: () => {
      if (!win || win.isDestroyed()) return undefined;
      return screenPointer(screen.getCursorScreenPoint(), win.getContentBounds());
    },
    open: () => couch?.screenCommand({ command: "quickEdge" }),
  });
  const screenListeners: Array<(playing: boolean) => void> = [];
  const lifecycle: CursorHost = {
    focused: () => win?.isFocused() === true,
    on: (event, cb) => {
      if (event === "quit") {
        app.on("before-quit", cb);
        app.on("will-quit", cb);
      } else if (event === "focus") win?.on("focus", cb);
      else if (event === "blur") win?.on("blur", cb);
      else if (event === "hide") win?.on("hide", cb);
      else win?.on("show", cb);
    },
    onScreen: (cb) => screenListeners.push(cb),
  };
  wireCursor(lifecycle, cursor);
  // Quick settings and its glass vanish at once, with no slide, when Couch is no longer in front or is quitting.
  wireTeardown(lifecycle, () => {
    drawer.teardown();
    couch?.screenCommand({ command: "quickClose" });
  });
  win.once("closed", () => {
    drawer.teardown();
    disposeNativeWindow();
  });
  // The edge gesture follows the same focus, hide and quit events but doesn't depend on playback.
  wireCursor(
    { ...lifecycle, onScreen: (cb) => cb(true) },
    { playing: () => edge.start(), release: () => edge.stop() },
  );
  wireQuickIpc({
    on: (channel, handler) => ipcMain.on(channel, (event, raw) => handler(event, raw)),
    isDrawer: (sender) => sender === drawer.webContents,
    ids: () => drawer.itemIds,
    send: (command) => couch?.screenCommand(command),
    slide: (phase) => drawer.slideStart(phase),
  });
  let nativeFront = false;
  couch.onScreen((payload) => {
    for (const listener of screenListeners) listener(payload.playing);
    // A native App view is under the window's web contents: Couch's own page goes transparent while it is in front.
    const nativeNow = nativeAppFront(payload.state, nativeApps);
    if (nativeNow !== nativeFront && win && !win.isDestroyed()) {
      nativeFront = nativeNow;
      void win.webContents.executeJavaScript(
        `document.body.classList.toggle(${JSON.stringify(NATIVE_APP_CLASS)}, ${nativeNow})`,
      );
    }
    // Only over a web App: adding a view above the window would reorder the native video under the Library's cover.
    cover.set(payload.state.pictureOff && payload.state.view === "app");
    front = { view: payload.state.view, app: payload.state.app };
    drawer.set(payload.quick);
    cover.showVolume(
      payload.state.volumeShown ? (payload.muted ? 0 : payload.state.volume) : undefined,
    );
    publishScreen();
  });
  // A hidden App isn't loaded at start; showing it again loads it on first open.
  if (resolveHomeApps(store, APP_ENTRIES).find((r) => r.id === "youtube")?.shown) youtube.start();
  publishScreen();
}

ipcMain.on(Channel.command, (_event, command: Command) => couch?.screenCommand(command));
ipcMain.on(Channel.grid, (_event, report: GridReport) =>
  couch?.reportGrid(report.viewKey, report.items),
);

ipcMain.on(Channel.glass, (_event, rects: GlassRect[]) => player?.setGlass(rects));

/** Developer-only (COUCH_WEBKIT_TEST_PAGE=1, see webkit-test-page.ts): a local page that plays a synthetic clip in the WebKit host. */
async function startTestPage(): Promise<TestPageServer | undefined> {
  if (!testPageEnabled(process.env)) return undefined;
  const clip = await ensureTestClip(join(app.getPath("userData"), "test-page"), findFfmpeg());
  if (!clip) {
    console.warn("[netflix] test page needs ffmpeg; using Netflix");
    return undefined;
  }
  const server = await serveTestPage(clip);
  app.on("will-quit", () => void server.close());
  return server;
}

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
