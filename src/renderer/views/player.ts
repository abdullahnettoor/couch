import type { ScreenPayload } from "../../shared/protocol.ts";
import { root } from "./dom.ts";

/** The video is drawn by mpv under this page and the overlay by player-overlay.ts; this view draws nothing. Black until the video shows. */
export function render(_payload: ScreenPayload): void {
  root.replaceChildren();
}
