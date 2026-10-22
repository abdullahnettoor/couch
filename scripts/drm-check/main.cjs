// DRM check: does Widevine load, and does protected video actually decode inside a WebContentsView?
//
//   pnpm drm-check              Shaka's public Widevine test stream, prints a report, quits
//   Electron scripts/drm-check/main.cjs --url <url>  Opens a service (Netflix, Prime...) to sign in and try;
//                                                     logs what the page's <video> is doing every 5 s
const { app, components, session, BrowserWindow, WebContentsView } = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");

const urlArg = process.argv.indexOf("--url");
const target = urlArg > 0 ? process.argv[urlArg + 1] : undefined;
const log = (...a) => console.log("[drm-check]", ...a);

// Services refuse "Electron/x" user agents; look like the Chrome this build is made from.
const CHROME_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const VIDEO_PROBE = `(() => {
  const v = [...document.querySelectorAll('video')].find((x) => x.currentTime > 0) || document.querySelector('video');
  if (!v) return { url: location.href, title: document.title, video: null };
  const q = v.getVideoPlaybackQuality();
  return {
    url: location.href,
    title: document.title,
    video: { size: v.videoWidth + 'x' + v.videoHeight, t: Math.round(v.currentTime), paused: v.paused,
      encrypted: !!v.mediaKeys, frames: q.totalVideoFrames, dropped: q.droppedVideoFrames,
      error: v.error && v.error.message },
  };
})()`;

app.whenReady().then(async () => {
  const t0 = Date.now();
  try {
    const result = await components.whenReady();
    log("components ready in", Date.now() - t0, "ms", JSON.stringify(result));
  } catch (e) {
    log("components FAILED", String(e));
  }

  const ses = session.fromPartition("persist:drm-check");
  ses.setUserAgent(CHROME_UA);
  const win = new BrowserWindow({ width: 1280, height: 760, show: true });
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.contentView.addChildView(view);
  const fit = () => {
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  fit();
  win.on("resize", fit);
  const wc = view.webContents;
  wc.on("console-message", (e) => {
    if (!/robustness level|Security Warning/.test(e.message)) log("page:", e.message.slice(0, 300));
  });

  if (target) {
    await wc.loadURL(target).catch((e) => log("load failed", String(e)));
    setInterval(async () => {
      const probe = await wc.executeJavaScript(VIDEO_PROBE).catch((e) => ({ error: String(e) }));
      log(JSON.stringify(probe));
    }, 5000);
    return;
  }

  await wc.loadFile(join(__dirname, "page.html"));
  const report = await wc.executeJavaScript("window.runSpike()");
  log("REPORT", JSON.stringify(report, null, 2));
  const shot = await wc.capturePage().catch(() => undefined);
  if (shot) writeFileSync(join(app.getPath("temp"), "drm-check-capture.png"), shot.toPNG());
  app.quit();
});
