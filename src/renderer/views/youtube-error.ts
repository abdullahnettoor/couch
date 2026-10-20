import { YOUTUBE_ERROR_ITEMS } from "../../shared/youtube-grid.ts";
import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, root } from "./dom.ts";

export function render(payload: ScreenPayload): void {
  root.replaceChildren();
  const view = el("div", "view page");
  view.append(el("h1", "page-title", "YouTube didn't load"));
  view.append(el("p", "", "Check the internet, then press OK to try again."));
  const list = el("div", "menu");
  for (const item of YOUTUBE_ERROR_ITEMS) {
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
