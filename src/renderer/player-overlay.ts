import { formatTime, type PlayerOverlay } from "../shared/player.ts";
import "./player-overlay.css";

const el = document.createElement("div");
el.id = "player-overlay";
el.hidden = true;
document.body.append(el);

function div(className: string, text?: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  if (text !== undefined) d.textContent = text;
  return d;
}

/** Draws the player overlay (title, progress, pause mark, note, volume) over the video. */
export function renderOverlay(overlay: PlayerOverlay | undefined): void {
  el.hidden = !overlay;
  if (!overlay) return el.replaceChildren();
  const parts: HTMLElement[] = [];
  if (overlay.bar) {
    const { position, duration } = overlay.bar;
    const frac = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    const bar = div("po-bar");
    const fill = div("po-fill");
    fill.style.width = `${frac * 100}%`;
    bar.append(fill);
    parts.push(
      div("po-title", overlay.title),
      bar,
      div("po-elapsed", formatTime(position)),
      div("po-remaining", `-${formatTime(Math.max(0, duration - position))}`),
    );
  }
  if (overlay.note) parts.push(div("po-note", overlay.note));
  if (overlay.paused) {
    const pause = div("po-pause");
    pause.append(document.createElement("i"), document.createElement("i"));
    parts.push(pause);
  }
  if (overlay.volume !== undefined) {
    const v = Math.min(100, Math.max(0, Math.round(overlay.volume)));
    const bar = div("po-vol-bar");
    const fill = div("po-fill");
    fill.style.width = `${v}%`;
    bar.append(fill);
    parts.push(div("po-vol", `Volume ${v}%`), bar);
  }
  el.replaceChildren(...parts);
}
