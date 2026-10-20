import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, root } from "./dom.ts";

export function render(payload: ScreenPayload): void {
  root.replaceChildren();
  const view = el("div", "view page");
  view.append(el("h1", "page-title", "Library folders"));
  const list = el("div", "menu wide");
  for (const item of payload.grid) {
    const focused = item.id === payload.focusedId ? " focused" : "";
    const row = el("div", `menu-item${focused}`);
    row.textContent = item.id === "add" ? "Add folder…" : item.label;
    if (item.id !== "add") row.append(el("span", "hint", focused ? "OK to remove" : ""));
    list.append(row);
  }
  view.append(list);
  root.append(view);
}
