import type { ScreenPayload } from "../shared/protocol.ts";
import { ICON_PATHS } from "../shared/icons.ts";

const toast = document.getElementById("toast")!;
const volume = document.getElementById("volume")!;

volume.innerHTML = `<span class="n num"></span><div class="lvl"><i></i></div><svg class="i" viewBox="0 0 24 24">${ICON_PATHS.speaker}</svg>`;
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
