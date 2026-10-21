import type { ScreenPayload } from "../shared/protocol.ts";
import { ICON_PATHS } from "../shared/icons.ts";

const toast = document.getElementById("toast")!;
const confirm = document.getElementById("confirm")!;
const volume = document.getElementById("volume")!;

volume.innerHTML = `<span class="n num"></span><div class="lvl"><i></i></div><svg class="i" viewBox="0 0 256 256">${ICON_PATHS.speaker}</svg>`;
const volumeNumber = volume.querySelector<HTMLElement>(".n")!;
const volumeFill = volume.querySelector<HTMLElement>(".lvl i")!;

/** Toast and volume level over the Screen; every view gets them for free. */
export function renderHud(payload: ScreenPayload): void {
  const level = Math.max(0, Math.min(100, Math.round(payload.state.volume)));
  volumeNumber.textContent = String(level);
  volumeFill.style.height = `${level}%`;
  volume.classList.toggle("show", Boolean(payload.state.volumeShown));
  if (payload.state.toast) toast.textContent = payload.state.toast;
  toast.classList.toggle("show", Boolean(payload.state.toast));
}

let confirmKey = "";

/** The question (Leave YouTube?, Quit Couch?) over every view; YouTube draws its own over the web view. */
export function renderConfirm(payload: ScreenPayload): void {
  const c = payload.state.confirm;
  const key = c ? `${c.title}|${c.buttons.join("|")}|${c.focus}` : "";
  if (key === confirmKey) return;
  confirmKey = key;
  confirm.classList.toggle("show", Boolean(c));
  if (!c) return;
  confirm.replaceChildren();
  const box = document.createElement("div");
  box.className = "box glass";
  const title = document.createElement("b");
  title.textContent = c.title;
  const row = document.createElement("div");
  row.className = "btns";
  c.buttons.forEach((label, i) => {
    const b = document.createElement("span");
    b.className = `g-pill${i === c.focus ? " focused" : ""}`;
    b.textContent = label;
    row.append(b);
  });
  box.append(title, row);
  confirm.append(box);
}
