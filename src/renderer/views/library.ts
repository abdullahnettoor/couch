import type { ScreenPayload } from "../../shared/protocol.ts";
import { el, root } from "./dom.ts";

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Draws both the Library's first page and the inside of a folder. */
export function render(payload: ScreenPayload): void {
  const lib = payload.library;
  root.replaceChildren();
  if (!lib) return;
  const view = el("div", "view page");
  view.append(el("h1", "page-title", escape(lib.heading)));
  if (lib.entries.length === 0) {
    view.append(el("div", "lib-empty", escape(lib.emptyText ?? "")));
  } else {
    const grid = el("div", "lib-grid");
    for (const e of lib.entries) {
      const classes = ["lib-tile", e.kind];
      if (e.path === payload.focusedId) classes.push("focused");
      if (e.missing) classes.push("missing");
      const tile = el("div", classes.join(" "), `<div class="t">${escape(e.title)}</div>`);
      tile.style.setProperty("--hue", String(e.hue));
      if (e.missing) tile.append(el("div", "note", "Drive not connected"));
      grid.append(tile);
    }
    view.append(grid);
  }
  root.append(view);
}
