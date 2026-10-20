import { YOUTUBE_ERROR_ITEMS } from "../../shared/youtube-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassPill, splitPage } from "./glass.ts";

export function render(payload: ScreenPayload): void {
  const retry = YOUTUBE_ERROR_ITEMS[0];
  splitPage({ icon: "restart" }, [
    el("h1", "", "YouTube didn't load"),
    el("p", "", "Check the internet, then press OK to try again."),
    glassPill(retry.id, retry.label, retry.id === payload.focusedId, "restart"),
  ]);
}
