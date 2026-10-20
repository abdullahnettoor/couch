import type { CouchApi } from "../shared/ipc.ts";
import { SCREEN_KEYS } from "../shared/keyboard.ts";
import { VIEWS } from "./views/index.ts";
import "./style.css";

declare global {
  interface Window {
    couch: CouchApi;
  }
}

window.addEventListener("keydown", (event) => {
  const command = SCREEN_KEYS[event.key];
  if (!command) return;
  event.preventDefault();
  window.couch.send({ command });
});

const toast = document.getElementById("toast")!;
const volume = document.getElementById("volume")!;
const notice = document.getElementById("notice")!;

window.couch.onScreen((payload) => {
  const view = VIEWS[payload.state.view];
  if (view?.grid?.length && payload.grid.length === 0) {
    window.couch.reportGrid({ viewKey: payload.viewKey, items: view.grid });
  }
  view?.render(payload);
  volume.textContent = `Volume ${payload.state.volume}%`;
  volume.classList.toggle("show", Boolean(payload.state.volumeShown));
  toast.textContent = payload.state.toast ?? "";
  toast.classList.toggle("show", Boolean(payload.state.toast));
});

window.couch.onMpv((status) => {
  notice.hidden = !status.missing && !status.message;
  notice.textContent = status.missing
    ? "Couch needs mpv to play videos. Install it with: brew install mpv"
    : (status.message ?? "");
});
