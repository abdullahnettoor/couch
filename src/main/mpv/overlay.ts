import type { PlayerOverlay } from "../../shared/player.ts";

const W = 1920;
const MARGIN = 90;
const BAR_W = W - MARGIN * 2;

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "＼").replace(/[{}]/g, "").replace(/\n/g, " ");
}

const TEXT = String.raw`\1c&HFFFFFF&\3c&H000000&\bord3\shad0`;

function rect(x: number, y: number, w: number, h: number, colour: string, alpha = "00"): string {
  return String.raw`{\an7\pos(${x},${y})\bord0\1c&H${colour}&\1a&H${alpha}&\p1}m 0 0 l ${w} 0 ${w} ${h} 0 ${h}{\p0}`;
}

/** The overlay as ASS event text (one event per line) for mpv's osd-overlay. */
export function overlayAss(overlay: PlayerOverlay): string {
  const lines: string[] = [];
  if (overlay.bar) {
    const { position, duration } = overlay.bar;
    const frac = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    lines.push(String.raw`{\an7\pos(${MARGIN},60)\fs52${TEXT}}${escapeAss(overlay.title)}`);
    lines.push(rect(MARGIN, 1000, BAR_W, 8, "FFFFFF", "A0"));
    lines.push(rect(MARGIN, 1000, Math.round(BAR_W * frac), 8, "5AB4F2"));
    lines.push(String.raw`{\an1\pos(${MARGIN},985)\fs38${TEXT}}${formatTime(position)}`);
    lines.push(
      String.raw`{\an3\pos(${W - MARGIN},985)\fs38${TEXT}}-${formatTime(Math.max(0, duration - position))}`,
    );
  }
  if (overlay.note) {
    lines.push(String.raw`{\an1\pos(${MARGIN},900)\fs44${TEXT}}${escapeAss(overlay.note)}`);
  }
  if (overlay.paused) {
    lines.push(rect(900, 495, 40, 130, "FFFFFF"));
    lines.push(rect(980, 495, 40, 130, "FFFFFF"));
  }
  if (overlay.volume !== undefined) {
    const v = Math.min(100, Math.max(0, Math.round(overlay.volume)));
    lines.push(String.raw`{\an9\pos(${W - MARGIN},60)\fs44${TEXT}}Volume ${v}%`);
    lines.push(rect(W - MARGIN - 300, 125, 300, 8, "FFFFFF", "A0"));
    lines.push(rect(W - MARGIN - 300, 125, 3 * v, 8, "5AB4F2"));
  }
  return lines.join("\n");
}
