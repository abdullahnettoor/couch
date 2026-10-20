import { formatTime, type PlayerOverlay } from "../shared/player.ts";
import { DOCK_IDS, DOCK_LABELS, type DockId } from "../shared/player-dock.ts";
import { iconSvg, type IconName } from "../shared/icons.ts";
import type { Command } from "../shared/protocol.ts";
import "./player-overlay.css";

const el = document.createElement("div");
el.id = "player-overlay";
el.hidden = true;
el.innerHTML = `
  <div class="po-scrim"></div>
  <div class="po-top">
    <h2 class="po-title"></h2>
    <div class="po-note glass"></div>
  </div>
  <div class="po-pause glass">${iconSvg("pause")}</div>
  <div class="po-vol volhud glass"><span class="n num"></span><div class="lvl"><i></i></div>${iconSvg("speaker")}</div>
  <div class="po-dock glass"></div>`;
document.body.append(el);

const $ = <T extends HTMLElement>(selector: string) => el.querySelector<T>(selector)!;
const title = $(".po-title");
const note = $(".po-note");
const pauseMark = $(".po-pause");
const vol = $(".po-vol");
const volNumber = vol.querySelector<HTMLElement>(".n")!;
const volFill = vol.querySelector<HTMLElement>(".lvl i")!;
const dock = $(".po-dock");

const BUTTON_ICONS: Partial<Record<DockId, IconName>> = {
  back10: "back10",
  fwd10: "fwd10",
  upnext: "list",
  subtitles: "cc",
  volicon: "speaker",
};

const parts = {} as Record<DockId, HTMLElement>;
for (const id of DOCK_IDS) {
  const node = document.createElement(id === "bar" || id === "volume" ? "div" : "button");
  node.className = `po-${id}`;
  node.dataset.dock = id;
  node.setAttribute("aria-label", DOCK_LABELS[id]);
  parts[id] = node;
}
parts.playpause.classList.add("db", "big");
for (const id of ["back10", "fwd10", "upnext", "subtitles", "volicon"] as const) {
  parts[id].classList.add("db");
  parts[id].innerHTML = iconSvg(BUTTON_ICONS[id]!);
}
parts.upnext.hidden = true;

parts.bar.classList.add("po-scrub");
parts.bar.innerHTML = `<span class="num po-pos"></span><div class="po-hit"><div class="po-track"><div class="po-fill"></div></div><div class="po-knob"></div><div class="po-tip glass"></div></div><span class="num po-rem"></span>`;
parts.volume.classList.add("po-vslider");
parts.volume.innerHTML = `<div class="po-track"><div class="po-fill"></div></div>`;
const hit = parts.bar.querySelector<HTMLElement>(".po-hit")!;
const barFill = hit.querySelector<HTMLElement>(".po-fill")!;
const knob = hit.querySelector<HTMLElement>(".po-knob")!;
const tip = hit.querySelector<HTMLElement>(".po-tip")!;
const pos = parts.bar.querySelector<HTMLElement>(".po-pos")!;
const rem = parts.bar.querySelector<HTMLElement>(".po-rem")!;
const volTrack = parts.volume.querySelector<HTMLElement>(".po-track")!;
const volSliderFill = volTrack.querySelector<HTMLElement>(".po-fill")!;
dock.append(...DOCK_IDS.map((id) => parts[id]));

let duration = 0;
let controlsUp = false;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Draws the player overlay (title, dock, pause mark, note, volume level) over the video. */
export function renderOverlay(overlay: PlayerOverlay | undefined): void {
  el.hidden = !overlay;
  if (!overlay) return;
  const d = overlay.dock;
  controlsUp = overlay.controls === "dock";
  el.classList.toggle("controls", controlsUp);
  title.textContent = overlay.title;
  note.textContent = overlay.note ?? "";
  note.classList.toggle("show", Boolean(overlay.note));
  pauseMark.classList.toggle("show", overlay.paused);
  const level = Math.min(100, Math.max(0, Math.round(overlay.volume ?? 0)));
  volNumber.textContent = String(level);
  volFill.style.height = `${level}%`;
  vol.classList.toggle("show", overlay.volume !== undefined);
  if (!d) return;
  duration = d.duration;
  const frac = d.duration > 0 ? clamp01(d.position / d.duration) : 0;
  barFill.style.width = `${frac * 100}%`;
  knob.style.left = `${frac * 100}%`;
  if (!hit.matches(":hover")) {
    tip.style.left = `${frac * 100}%`;
    tip.textContent = formatTime(d.position);
  }
  pos.textContent = formatTime(d.position);
  rem.textContent = `-${formatTime(Math.max(0, d.duration - d.position))}`;
  parts.playpause.innerHTML = iconSvg(overlay.paused ? "play" : "pause");
  parts.subtitles.classList.toggle("on", d.subtitlesOn);
  volSliderFill.style.width = `${Math.min(100, Math.max(0, d.level))}%`;
  parts.upnext.hidden = !d.upNext;
  for (const id of DOCK_IDS) parts[id].classList.toggle("focused", id === d.focusedId);
}

const send = (command: Command) => window.couch.send(command);
const fractionOf = (event: MouseEvent, node: HTMLElement) => {
  const box = node.getBoundingClientRect();
  return clamp01((event.clientX - box.left) / box.width);
};

el.addEventListener("click", (event) => {
  const target = event.target as Element;
  const id = target.closest<HTMLElement>("[data-dock]")?.dataset.dock as DockId | undefined;
  if (!id) {
    if (!target.closest(".po-dock")) send({ command: "playpause" });
    return;
  }
  if (id === "playpause") send({ command: "playpause" });
  else if (id === "back10") send({ command: "seekBy", args: { seconds: -10 } });
  else if (id === "fwd10") send({ command: "seekBy", args: { seconds: 10 } });
  else if (id === "subtitles") send({ command: "subtitles" });
  else if (id === "bar" && target.closest(".po-hit"))
    send({ command: "seekTo", args: { seconds: Math.round(fractionOf(event, hit) * duration) } });
  else if (id === "volume")
    send({
      command: "volSet",
      args: { percent: Math.round(fractionOf(event, volTrack) * 100) },
    });
});

el.addEventListener("mousemove", (event) => {
  if (event.target instanceof Element && event.target.closest(".po-hit")) {
    tip.style.left = `${fractionOf(event, hit) * 100}%`;
    tip.textContent = formatTime(fractionOf(event, hit) * duration);
  }
});

el.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    send({ command: event.deltaY < 0 ? "volUp" : "volDown" });
  },
  { passive: false },
);

let lastMove = 0;
window.addEventListener("mousemove", () => {
  if (el.hidden) return;
  const now = Date.now();
  if (now - lastMove < 250) return;
  lastMove = now;
  send({ command: "showControls" });
});
