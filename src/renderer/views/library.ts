import type { LibraryEntry, ScreenPayload } from "../../shared/protocol.ts";
import { iconSvg } from "../../shared/icons.ts";
import { el, focusable, root } from "./dom.ts";
import { topbar } from "./glass.ts";

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function caption(e: LibraryEntry): string {
  const small = e.missing
    ? "Drive not connected"
    : e.kind === "folder"
      ? e.count === undefined
        ? ""
        : e.count === 0
          ? "Empty"
          : `${e.count} ${e.count === 1 ? "item" : "items"}`
      : e.watched
        ? "Watched"
        : (e.progress?.left ?? "");
  return `${escape(e.title)}${small ? `<small>${escape(small)}</small>` : ""}`;
}

function picture(e: LibraryEntry): string {
  if (e.kind === "folder") {
    const frames = e.mosaic ?? [];
    if (!frames.length) return `<div class="lib-plain"></div>`;
    const shown =
      frames.length < 4 ? [...frames, ...frames].slice(0, frames.length > 1 ? 4 : 1) : frames;
    return `<div class="lib-mosaic${shown.length === 1 ? " one" : ""}">${shown
      .map((u) => `<img src="${escape(u)}" alt="">`)
      .join("")}</div>`;
  }
  return e.thumb
    ? `<img class="lib-cover" src="${escape(e.thumb)}" alt="">`
    : `<div class="lib-plain" style="--hue:${e.hue}"></div>`;
}

/** `withFolder`: Continue watching cards say which folder the video is in. */
function card(e: LibraryEntry, payload: ScreenPayload, withFolder = false): HTMLElement {
  const classes = ["lib-card"];
  if (e.path === payload.focusedId) classes.push("focused");
  if (e.missing) classes.push("missing");
  const bar = e.progress
    ? `<div class="lib-prog"><i style="width:${Math.round(e.progress.fraction * 100)}%"></i></div>`
    : "";
  const badge = e.watched ? `<span class="lib-badge">Watched</span>` : "";
  const cap =
    withFolder && e.progress && e.folder
      ? { ...e, progress: { ...e.progress, left: `${e.progress.left} · ${e.folder}` } }
      : e;
  const node = el(
    "button",
    classes.join(" "),
    `<div class="g-tile">${picture(e)}${bar}${badge}</div><div class="g-cap">${caption(cap)}</div>`,
  );
  return focusable(node, e.path);
}

let scrollTop = 0;
let lastKey = "";

/** Draws both the Library's first page and the inside of a folder. */
export function render(payload: ScreenPayload): void {
  const lib = payload.library;
  root.replaceChildren();
  if (!lib) return;
  const page = el("div", "screen-glass");
  page.append(topbar(payload));
  const inFolder = payload.viewKey !== "library";
  page.append(
    el("div", "lib-head", `${inFolder ? "<small>Library</small>" : ""}${escape(lib.heading)}`),
  );
  const body = el("div", "lib-body");
  if (lib.entries.length === 0) {
    body.append(
      el(
        "div",
        "lib-empty glass",
        `${iconSvg("folder")}<span>${escape(lib.emptyText ?? "")}</span>`,
      ),
    );
  } else if (inFolder) {
    const grid = el("div", "lib-grid");
    for (const e of lib.entries) grid.append(card(e, payload));
    body.append(grid);
  } else {
    const cont = lib.continueWatching ?? [];
    if (cont.length) {
      body.append(el("div", "lib-rowh", "Continue watching"));
      const shelf = el("div", "lib-shelf");
      for (const e of cont) shelf.append(card(e, payload, true));
      body.append(shelf);
      body.append(el("div", "lib-rowh", "Folders"));
    }
    const shelf = el("div", "lib-grid");
    for (const e of lib.entries) shelf.append(card(e, payload));
    body.append(shelf);
  }
  page.append(body);
  root.append(page);
  if (payload.viewKey !== lastKey) {
    lastKey = payload.viewKey;
    scrollTop = 0;
  }
  body.scrollTop = scrollTop;
  const focused = body.querySelector<HTMLElement>(".lib-card.focused");
  if (focused) {
    const margin = 60 * (window.innerWidth / 1920);
    const top = focused.offsetTop - margin;
    const bottom = focused.offsetTop + focused.offsetHeight + margin * 2;
    if (top < body.scrollTop) body.scrollTop = Math.max(0, top);
    else if (bottom > body.scrollTop + body.clientHeight)
      body.scrollTop = bottom - body.clientHeight;
  }
  scrollTop = body.scrollTop;
}
