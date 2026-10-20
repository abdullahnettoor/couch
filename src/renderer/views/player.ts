import type { ScreenPayload } from "../../shared/protocol.ts";
import { root } from "./dom.ts";

/** The video and its overlay are drawn by mpv; the Screen just stays black behind it. */
export function render(_payload: ScreenPayload): void {
  root.replaceChildren();
}
