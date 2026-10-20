import { app, type BrowserWindow } from "electron";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Time for macOS to finish sliding to Couch's full-screen Space after it takes focus. */
const SPACE_SETTLE_MS = 700;

/**
 * Brings Couch's window (and its full-screen Space) to the front. mpv's window opens on whichever
 * Space is active, so this must run before a video loads or the video lands outside Couch.
 */
export async function revealScreen(win: BrowserWindow, timeoutMs = 1500): Promise<void> {
  if (win.isDestroyed() || (win.isFocused() && win.isVisible())) return;
  const focused = new Promise<void>((resolve) => win.once("focus", () => resolve()));
  win.show();
  app.focus({ steal: true });
  win.focus();
  await Promise.race([focused, sleep(timeoutMs)]);
  if (win.isFullScreen()) await sleep(SPACE_SETTLE_MS);
}
