import type { GridItem, ScreenPayload } from "../shared/protocol.ts";
import type { CouchApi } from "../shared/ipc.ts";
import { wheelScrolls, wheelSteps } from "./wheel-steps.ts";
import { keyCommand } from "./picture-off-keys.ts";
import { VIEWS } from "./views/index.ts";
import { showing } from "./views/glass.ts";
import { renderConfirm, renderHud } from "./hud.ts";
import { renderSetup, setupTakesKey } from "./setup.ts";
import { renderPictureOff } from "./picture-off.ts";
import { interfaceSounds } from "./interface-sounds.ts";
import { isTypingTarget, syncTyping } from "./views/typing.ts";
import { renderOverlay, setNativeGlass, setVideoTint } from "./player-overlay.ts";
import { darkTint } from "../shared/glass-tint.ts";
import { iconSvg } from "../shared/icons.ts";
import { GLASS, lookCss } from "../shared/look.ts";
import "./style.css";
import "./glass.css";
import "./home.css";

document.head.append(
  Object.assign(document.createElement("style"), {
    textContent: lookCss(GLASS, { unit: "var(--u)" }),
  }),
);

declare global {
  interface Window {
    couch: CouchApi;
  }
}

window.addEventListener("keydown", (event) => {
  if (setupTakesKey()) return event.preventDefault();
  const command = keyCommand(
    { key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey },
    current?.state.pictureOff === true,
    current?.screenTyping !== undefined,
    current?.quick !== undefined,
  );
  if (!command) return;
  event.preventDefault();
  window.couch.send(command);
});

let current: ScreenPayload | undefined;

// The Library and its pages scroll like the keys do: the wheel moves the highlight and the page follows.
const wheelStep = wheelSteps();
window.addEventListener(
  "wheel",
  (event) => {
    if (!current || !wheelScrolls(current)) return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    for (const command of wheelStep(event, event.timeStamp)) window.couch.send(command);
  },
  { passive: false },
);
const itemAt = (event: MouseEvent) => {
  const id = (event.target as Element | null)?.closest<HTMLElement>("[data-id]")?.dataset.id;
  return current?.grid.find((i) => i.id === id);
};
const focusItem = (item: GridItem) =>
  window.couch.send({ command: "focusAt", args: { r: item.r, c: item.c } });

// Real movement only: a view drawn under a resting cursor fires mouseover without the mouse moving, which
// would steal focus from the view's first tile (or its last-focused one).
window.addEventListener("mousemove", (event) => {
  // Ambient Home hides every tile: any movement wakes it (the core swallows this first command).
  if (current?.ambient) return window.couch.send({ command: "focusAt", args: { r: -1, c: -1 } });
  const item = itemAt(event);
  if (item && item.id !== current?.focusedId) focusItem(item);
});
// Long press on a tile opens its menu (Fix match for shows and films).
let pressTimer: number | undefined;
let pressed = false;
window.addEventListener("mousedown", (event) => {
  const item = event.button === 0 ? itemAt(event) : undefined;
  window.clearTimeout(pressTimer);
  pressed = false;
  if (!item) return;
  pressTimer = window.setTimeout(() => {
    pressed = true;
    focusItem(item);
    window.couch.send({ command: "menu" });
  }, 600);
});
window.addEventListener("mouseup", () => window.clearTimeout(pressTimer));
window.addEventListener(
  "click",
  (event) => {
    if (!pressed) return;
    pressed = false;
    event.stopImmediatePropagation();
  },
  true,
);
window.addEventListener("click", (event) => {
  if (isTypingTarget(event.target)) return;
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
  // Ambient Home hides every tile: any movement wakes it (the core swallows this first command).
  if (current?.ambient) return window.couch.send({ command: "focusAt", args: { r: -1, c: -1 } });
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
  showing(payload);
  view?.render(payload);
  syncTyping(payload, payload.search?.query ?? "");
  // Transparent only once mpv reports a duration (the video is on screen); black before that.
  const playing = payload.state.view === "player" && (payload.state.player?.dur ?? 0) > 0;
  document.body.classList.toggle("video-visible", playing);
  document.body.classList.toggle("video-pending", payload.state.view === "player" && !playing);
  renderOverlay(payload.state.view === "player" ? payload.overlay : undefined);
  renderHud(payload);
  renderSetup(payload);
  renderConfirm(payload);
  renderPictureOff(payload);
});

window.couch.onSound(interfaceSounds());
window.couch.onTint((rgb) => setVideoTint(rgb ? darkTint(rgb) : undefined));
window.couch.onMpv((status) => {
  setNativeGlass(status.nativeGlass === true);
  if (status.missing) {
    notice.innerHTML = `${iconSvg("play")}<span><b>Couch needs mpv</b>to play videos. Install it with: brew install mpv</span>`;
  } else if (status.message) {
    notice.textContent = status.message;
  }
  notice.classList.toggle("show", Boolean(status.missing || status.message));
});
