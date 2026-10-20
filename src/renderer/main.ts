import type { GridItem, ScreenPayload } from "../shared/protocol.ts";
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

let hideCursor: ReturnType<typeof setTimeout> | undefined;
document.body.classList.add("idle");
window.addEventListener("mousemove", () => {
  document.body.classList.remove("idle");
  clearTimeout(hideCursor);
  hideCursor = setTimeout(() => document.body.classList.add("idle"), 3000);
});

const toast = document.getElementById("toast")!;
const volume = document.getElementById("volume")!;
const notice = document.getElementById("notice")!;

window.couch.onScreen((payload) => {
  current = payload;
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
