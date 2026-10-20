import type { GridItem, ScreenPayload } from "../shared/protocol.ts";
import type { CouchApi } from "../shared/ipc.ts";
import { SCREEN_KEYS } from "../shared/keyboard.ts";
import { VIEWS } from "./views/index.ts";
import { renderHud } from "./hud.ts";
import { renderOverlay } from "./player-overlay.ts";
import "./style.css";
import "./glass.css";
import "./home.css";

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

let current: ScreenPayload | undefined;
const itemAt = (event: MouseEvent) => {
  const id = (event.target as Element | null)?.closest<HTMLElement>("[data-id]")?.dataset.id;
  return current?.grid.find((i) => i.id === id);
};
const focusItem = (item: GridItem) =>
  window.couch.send({ command: "focusAt", args: { r: item.r, c: item.c } });

window.addEventListener("mouseover", (event) => {
  const item = itemAt(event);
  if (item && item.id !== current?.focusedId) focusItem(item);
});
window.addEventListener("click", (event) => {
  const item = itemAt(event);
  if (!item) return;
  focusItem(item);
  window.couch.send({ command: "ok" });
});
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.couch.send({ command: "back" });
});
window.addEventListener("mouseup", (event) => {
  if (event.button === 3) {
    event.preventDefault();
    window.couch.send({ command: "back" });
  }
});

window.addEventListener("mousemove", (event) => {
  const tile = (event.target as Element | null)?.closest<HTMLElement>(".g-tile");
  if (!tile) return;
  const box = tile.getBoundingClientRect();
  tile.style.setProperty("--sx", `${((event.clientX - box.left) / box.width) * 100}%`);
  tile.style.setProperty("--sy", `${((event.clientY - box.top) / box.height) * 100}%`);
});

let hideCursor: ReturnType<typeof setTimeout> | undefined;
document.body.classList.add("idle");
window.addEventListener("mousemove", () => {
  document.body.classList.remove("idle");
  clearTimeout(hideCursor);
  hideCursor = setTimeout(() => document.body.classList.add("idle"), 3000);
});

const notice = document.getElementById("notice")!;

window.couch.onScreen((payload) => {
  current = payload;
  const view = VIEWS[payload.state.view];
  if (view?.grid?.length && payload.grid.length === 0) {
    window.couch.reportGrid({ viewKey: payload.viewKey, items: view.grid });
  }
  view?.render(payload);
  // Transparent only once mpv reports a duration (the video is on screen); black before that.
  const playing = payload.state.view === "player" && (payload.state.player?.dur ?? 0) > 0;
  document.body.classList.toggle("video-visible", playing);
  document.body.classList.toggle("video-pending", payload.state.view === "player" && !playing);
  renderOverlay(payload.state.view === "player" ? payload.overlay : undefined);
  renderHud(payload);
});

window.couch.onMpv((status) => {
  notice.hidden = !status.missing && !status.message;
  notice.textContent = status.missing
    ? "Couch needs mpv to play videos. Install it with: brew install mpv"
    : (status.message ?? "");
});
