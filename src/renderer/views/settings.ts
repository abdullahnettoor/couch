import { SETTINGS_ITEMS } from "../../shared/settings-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, root } from "./dom.ts";

export function render(payload: ScreenPayload): void {
  root.replaceChildren();
  const view = el("div", "view page");
  view.append(el("h1", "page-title", "Settings"));
  const list = el("div", "menu");
  for (const item of SETTINGS_ITEMS) {
    list.append(
      el("div", `menu-item${item.id === payload.focusedId ? " focused" : ""}`, item.label),
    );
  }
  view.append(list);
  root.append(view);
}
