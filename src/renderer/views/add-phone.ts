import { ADD_PHONE_ITEMS } from "../../shared/settings-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, qrSvg } from "./dom.ts";
import { glassPill, splitPage } from "./glass.ts";

export function render(payload: ScreenPayload): void {
  const done = ADD_PHONE_ITEMS[0];
  splitPage({ html: qrSvg(payload.pairingUrl) }, [
    el("h1", "", "Add a phone"),
    el(
      "p",
      "",
      "Scan this with your phone's camera. Your phone must be on the same Wi-Fi as this Mac.",
    ),
    glassPill(done.id, "Done", done.id === payload.focusedId, "check"),
  ]);
}
