import { ADD_PHONE_ITEMS } from "../../shared/settings-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, qrSvg, root } from "./dom.ts";

export function render(payload: ScreenPayload): void {
  root.replaceChildren();
  const view = el("div", "view page");
  view.append(el("h1", "page-title", "Add a phone"));
  const done = ADD_PHONE_ITEMS[0];
  const qr = el(
    "div",
    "qr-big",
    `<div class="qr">${qrSvg(payload.pairingUrl)}</div>` +
      `<p>Scan this with your phone's camera. Your phone must be on the same Wi-Fi as this Mac.</p>`,
  );
  qr.append(
    focusable(
      el("div", `menu-item${done.id === payload.focusedId ? " focused" : ""}`, "Done"),
      done.id,
    ),
  );
  view.append(qr);
  root.append(view);
}
