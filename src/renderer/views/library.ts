import type { LibraryEntry, ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, root } from "./dom.ts";

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function tile(e: LibraryEntry, payload: ScreenPayload): HTMLElement {
  const classes = ["lib-tile", e.kind];
  if (e.path === payload.focusedId) classes.push("focused");
  if (e.missing) classes.push("missing");
  const tag = e.watched ? '<div class="tag">Watched</div>' : "";
  const left = e.progress ? `<div class="left">${escape(e.progress.left)}</div>` : "";
  const bar = e.progress
    ? `<div class="bar"><i style="width:${Math.round(e.progress.fraction * 100)}%"></i></div>`
    : "";
  const node = el(
    "div",
    classes.join(" "),
    `${tag}<div class="t">${escape(e.title)}</div>${left}${bar}`,
  );
  focusable(node, e.path);
  node.style.setProperty("--hue", String(e.hue));
  if (e.thumb) {
    node.style.backgroundImage = `url("${e.thumb}")`;
    node.classList.add("has-thumb");
  }
  if (e.missing) node.append(el("div", "note", "Drive not connected"));
  return node;
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
    const cont = lib.continueWatching ?? [];
    if (cont.length) {
      view.append(el("h2", "lib-sub", "Continue watching"));
      const row = el("div", "lib-row");
      for (const e of cont) row.append(tile(e, payload));
      view.append(row);
    }
    const grid = el("div", "lib-grid");
    for (const e of lib.entries) grid.append(tile(e, payload));
    view.append(grid);
  }
  root.append(view);
}
