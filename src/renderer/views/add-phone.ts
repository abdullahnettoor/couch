import { ADD_PHONE_ITEMS } from "../../shared/settings-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, qrSvg, root } from "./dom.ts";

export function render(payload: ScreenPayload): void {
  root.replaceChildren();
  const view = el("div", "view page");
  view.append(el("h1", "page-title", "Add a phone"));
  view.append(
    el(
      "div",
      "qr-big",
      `<div class="qr">${qrSvg(payload.pairingUrl)}</div>` +
        `<p>Scan this with your phone's camera. Your phone must be on the same Wi-Fi as this Mac.</p>` +
        `<div class="menu-item${ADD_PHONE_ITEMS[0].id === payload.focusedId ? " focused" : ""}">Done</div>`,
    ),
  );
  root.append(view);
}
