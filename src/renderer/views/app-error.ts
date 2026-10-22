import { APP_ERROR_ITEMS } from "../../shared/app-grid.ts";
import { appEntry } from "../../main/apps/index.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el } from "./dom.ts";
import { glassPill, splitPage } from "./glass.ts";

export function render(payload: ScreenPayload): void {
  const retry = APP_ERROR_ITEMS[0];
  splitPage({ icon: "restart" }, [
    el("h1", "", `${appEntry(payload.state.app)?.label ?? "The App"} didn't load`),
    el(
      "p",
      "",
      payload.state.appNote
        ? `${payload.state.appNote} Press OK to try again.`
        : "Check the internet, then press OK to try again.",
    ),
    glassPill(retry.id, retry.label, retry.id === payload.focusedId, "restart"),
  ]);
}
