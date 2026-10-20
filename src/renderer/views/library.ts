import type { LibraryEntry, LibraryRow, ScreenPayload } from "../../shared/protocol.ts";
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
      : [e.line, e.watched ? "Watched" : e.progress?.left].filter(Boolean).join(" · ");
  return `${escape(e.title)}${small ? `<small>${escape(small)}</small>` : ""}`;
}

const tileId = (e: LibraryEntry) => e.id ?? e.path;

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
function card(
  e: LibraryEntry,
  payload: ScreenPayload,
  withFolder = false,
  shape = "",
): HTMLElement {
  const classes = ["lib-card"];
  if (shape) classes.push(shape);
  if (tileId(e) === payload.focusedId) classes.push("focused");
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
  return focusable(node, tileId(e));
}

/** Poster tiles without a picture show their title over the plain colour, as the prototype's Frames mode. */
function posterLabel(node: HTMLElement, e: LibraryEntry): void {
  if (e.thumb) return;
  node.querySelector(".g-tile")!.append(el("div", "lib-lbl", escape(e.title)));
}

let scrollTop = 0;
let lastKey = "";

/** Draws both the Library's first page and the inside of a folder. */
export function render(payload: ScreenPayload): void {
  const lib = payload.library;
  if (lib?.rows?.length && payload.viewKey === "library") return renderRoot(payload);
  page = undefined;
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

/** The first page keeps one backdrop layer so a change of focus can cross-fade. */
let page: HTMLElement | undefined;
let backdrop: HTMLElement | undefined;
let backdropKey = "";
const shelfScroll = new Map<string, number>();

function focusedEntry(payload: ScreenPayload): LibraryEntry | undefined {
  const lib = payload.library!;
  return [...lib.rows!.flatMap((r) => r.entries), ...lib.entries].find(
    (e) => tileId(e) === payload.focusedId,
  );
}

function syncBackdrop(e: LibraryEntry | undefined): void {
  const url = e?.thumb ?? e?.mosaic?.[0] ?? "";
  const key = `${e ? tileId(e) : ""}|${url}`;
  if (key === backdropKey) return;
  backdropKey = key;
  const frame = el("div", "lf-frame");
  frame.style.setProperty("--hue", String(e?.hue ?? 0));
  if (url) frame.style.backgroundImage = `url("${url}")`;
  backdrop!.append(frame);
  requestAnimationFrame(() => frame.classList.add("on"));
  const old = Array.from(backdrop!.children).slice(0, -1);
  window.setTimeout(() => old.forEach((n) => n.remove()), 700);
}

function renderRoot(payload: ScreenPayload): void {
  const lib = payload.library!;
  if (!page || root.firstElementChild !== page) {
    page = el("div", "screen-glass lib-first");
    backdrop = el("div", "lf-bg");
    backdropKey = "";
    root.replaceChildren(page);
  }
  const focused = focusedEntry(payload);
  syncBackdrop(focused);
  const feat = focused?.feature;
  const featured = el(
    "div",
    "lf-feat",
    feat
      ? `<div class="k">${escape([feat.kind.toUpperCase(), feat.sub].filter(Boolean).join(" · "))}</div><h1>${escape(feat.title)}</h1>`
      : "",
  );
  const body = el("div", "lib-body lf-body");
  const rowBlock = (row: LibraryRow): HTMLElement => {
    const block = el("div", "lf-block", `<div class="lib-rowh">${escape(row.title)}</div>`);
    const shelf = el("div", "lf-shelf");
    const shape = row.poster ? "post" : "wide";
    for (const e of row.entries) {
      const c = card(e, payload, row.id === "continue", shape);
      if (row.poster) posterLabel(c, e);
      shelf.append(c);
    }
    block.append(shelf);
    return block;
  };
  for (const row of lib.rows!) body.append(rowBlock(row));
  if (lib.entries.length) {
    const block = el("div", "lf-block", `<div class="lib-rowh">Folders</div>`);
    const grid = el("div", "lib-grid lf-folders");
    for (const e of lib.entries) grid.append(card(e, payload));
    block.append(grid);
    body.append(block);
  }
  page.replaceChildren(backdrop!, featured, body, topbar(payload));

  // Scroll after attaching so offsets exist: the focused row to the top, and the tile inside its shelf.
  const card_ = body.querySelector<HTMLElement>(".lib-card.focused");
  if (!card_) return;
  const block = card_.closest<HTMLElement>(".lf-block")!;
  body.scrollTop = block.offsetTop;
  const shelf = card_.closest<HTMLElement>(".lf-shelf");
  if (shelf) {
    const id = block.querySelector(".lib-rowh")!.textContent!;
    const u = window.innerWidth / 1920;
    let left = shelfScroll.get(id) ?? 0;
    const pad = 24 * u;
    if (card_.offsetLeft - pad < left) left = card_.offsetLeft - pad;
    else if (card_.offsetLeft + card_.offsetWidth + 96 * u > left + shelf.clientWidth)
      left = card_.offsetLeft + card_.offsetWidth + 96 * u - shelf.clientWidth;
    shelf.scrollLeft = left;
    shelfScroll.set(id, shelf.scrollLeft);
  }
}
