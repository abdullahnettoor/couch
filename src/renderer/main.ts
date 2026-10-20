import type { CouchApi, ScreenCommand, ScreenStatus } from "../shared/ipc.ts";
import "./style.css";

declare global {
  interface Window {
    couch: CouchApi;
  }
}

const KEYS: Record<string, ScreenCommand> = {
  p: "play",
  " ": "togglePause",
  ArrowLeft: "seekBack",
  ArrowRight: "seekForward",
  s: "stop",
  Escape: "stop",
  q: "quit",
};

window.addEventListener("keydown", (event) => {
  const command = KEYS[event.key];
  if (command) {
    event.preventDefault();
    window.couch.send(command);
  }
});

const clock = document.getElementById("clock")!;
const notice = document.getElementById("notice")!;
const statusLine = document.getElementById("status")!;

function tick(): void {
  clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
tick();
setInterval(tick, 10_000);

window.couch.onStatus((status: ScreenStatus) => {
  notice.hidden = !status.mpvMissing && !status.message;
  notice.textContent = status.mpvMissing
    ? "Couch needs mpv to play videos. Install it with: brew install mpv"
    : (status.message ?? "");
  statusLine.textContent = status.playing
    ? `${status.paused ? "Paused" : "Playing"} · ${status.position.toFixed(1)} s`
    : "Ready";
});
