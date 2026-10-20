import { SETTINGS_ITEMS } from "../../shared/settings-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, root } from "./dom.ts";

export function render(payload: ScreenPayload): void {
  root.replaceChildren();
  const view = el("div", "view page");
  view.append(el("h1", "page-title", "Settings"));
  const list = el("div", "menu");
  for (const item of SETTINGS_ITEMS) {
    list.append(
      focusable(
        el("div", `menu-item${item.id === payload.focusedId ? " focused" : ""}`, item.label),
        item.id,
      ),
    );
  }
  view.append(list);
  root.append(view);
}
