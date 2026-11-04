import type { LibraryEntry, LibraryRow, ScreenPayload } from "../../shared/protocol.ts";
import { iconSvg } from "../../shared/icons.ts";
import { designUnit } from "../../shared/design-unit.ts";
import { GLASS } from "../../shared/look.ts";
import { el, focusable, genreLabels, root } from "./dom.ts";
import { cornerBack, topbar } from "./glass.ts";

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
export function card(
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
export function posterLabel(node: HTMLElement, e: LibraryEntry): void {
  if (e.thumb) return;
  node.querySelector(".g-tile")!.append(el("div", "lib-lbl", escape(e.title)));
}

let scrollTop = 0;
let lastKey = "";

/** Draws both the Library's first page and the inside of a folder. */
export function render(payload: ScreenPayload): void {
  const lib = payload.library;
  if (lib?.rows?.length && payload.viewKey === "library") return renderRoot(payload);
  firstPage = undefined;
  root.replaceChildren();
  if (!lib) return;
  const page = el("div", "screen-glass");
  page.append(topbar(payload));
  const inFolder = payload.viewKey !== "library";
  page.append(...cornerBack(payload));
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
    const margin =
      GLASS.metrics.library.scrollMarginBlock * designUnit(window.innerWidth, window.innerHeight);
    const top = focused.offsetTop - margin;
    const bottom = focused.offsetTop + focused.offsetHeight + margin * 2;
    if (top < body.scrollTop) body.scrollTop = Math.max(0, top);
    else if (bottom > body.scrollTop + body.clientHeight)
      body.scrollTop = bottom - body.clientHeight;
  }
  scrollTop = body.scrollTop;
}

/** The first firstPage keeps one backdrop layer so a change of focus can cross-fade. */
let firstPage: HTMLElement | undefined;
let backdrop: HTMLElement | undefined;
let backdropKey = "";
const shelfScroll = new Map<string, number>();
let bodyScroll: number | undefined;
let chipScroll = 0;

/** Slides the chip row so the focused chip is fully visible, clear of the edge fades. */
function scrollChips(row: HTMLElement, track: HTMLElement): void {
  const chip = track.querySelector<HTMLElement>(".focused");
  const edge =
    GLASS.metrics.library.scrollMarginEdge * designUnit(window.innerWidth, window.innerHeight);
  let left = chipScroll;
  if (chip) {
    const { offsetLeft: from, offsetWidth: width } = chip;
    if (from - edge < left) left = from - edge;
    else if (from + width + edge > left + row.clientWidth)
      left = from + width + edge - row.clientWidth;
  }
  left = Math.max(0, Math.min(left, track.scrollWidth - row.clientWidth));
  track.style.transform = `translateX(${-chipScroll}px)`;
  void track.offsetHeight;
  track.style.transition = "transform 0.45s var(--ease)";
  track.style.transform = `translateX(${-left}px)`;
  chipScroll = left;
}

function focusedEntry(payload: ScreenPayload): { e?: LibraryEntry; poster: boolean } {
  const lib = payload.library!;
  const find = (id: string | undefined) => {
    for (const row of lib.rows!) {
      const e = row.entries.find((x) => tileId(x) === id);
      if (e) return { e, poster: row.poster === true };
    }
    const e = lib.entries.find((x) => tileId(x) === id);
    return e ? { e, poster: false } : undefined;
  };
  return find(payload.focusedId) ?? find(lib.featuredId) ?? { poster: false };
}

/** The featured area's picture: the TMDB backdrop, else a frame (a poster tile's picture is no backdrop). */
function syncBackdrop(e: LibraryEntry | undefined, poster: boolean): void {
  const url = e?.feature?.backdrop ?? (poster ? "" : (e?.thumb ?? e?.mosaic?.[0] ?? ""));
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

/** The title shrinks a step or two before it is cut; a two-line title leaves the overview two lines. */
function fitFeatured(featured: HTMLElement): void {
  const title = featured.querySelector<HTMLElement>("h1");
  if (!title) return;
  const pad = parseFloat(getComputedStyle(title).paddingBottom);
  for (const step of ["", "s1", "s2"]) {
    title.className = step;
    // A clamped title's scrollHeight counts the padding on top of its box.
    if (title.scrollHeight <= title.clientHeight + pad + 1) break;
  }
  const size = parseFloat(getComputedStyle(title).fontSize);
  featured.classList.toggle("two", (title.clientHeight - pad) / size > 1.5);
}

function renderRoot(payload: ScreenPayload): void {
  const lib = payload.library!;
  if (!firstPage || root.firstElementChild !== firstPage) {
    firstPage = el("div", "screen-glass lib-first");
    bodyScroll = undefined;
    backdrop = el("div", "lf-bg");
    backdropKey = "";
    root.replaceChildren(firstPage);
  }
  const { e: focused, poster } = focusedEntry(payload);
  syncBackdrop(focused, poster);
  const feat = focused?.feature;
  const featured = el(
    "div",
    "lf-feat",
    feat
      ? `<div class="k">${escape([feat.kind.toUpperCase(), feat.sub].filter(Boolean).join(" · "))}</div>${genreLabels(feat.genres)}<h1>${escape(feat.title)}</h1>${feat.overview ? `<p>${escape(feat.overview)}</p>` : ""}`
      : "",
  );
  const body = el("div", "lib-body lf-body");
  const chips = lib.chips?.length ? el("div", "lf-chips") : undefined;
  const chipTrack = el("div", "lf-chiptrack");
  chips?.append(chipTrack);
  for (const c of lib.chips ?? [])
    chipTrack.append(
      focusable(
        el(
          "button",
          `g-pill lf-chip${c.active ? " on" : ""}${payload.focusedId === `chip:${c.key}` ? " focused" : ""}`,
          escape(c.label),
        ),
        `chip:${c.key}`,
      ),
    );
  const rowBlock = (row: LibraryRow): HTMLElement => {
    const block = el("div", "lf-block", `<div class="lib-rowh">${escape(row.title)}</div>`);
    const shelf = el("div", "lf-shelf");
    const track = el("div", "lf-track");
    const shape = row.poster ? "post" : "wide";
    for (const e of row.entries) {
      const c = card(e, payload, row.id === "continue", shape);
      if (row.poster) posterLabel(c, e);
      track.append(c);
    }
    shelf.append(track);
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
  firstPage.replaceChildren(
    backdrop!,
    featured,
    ...(chips ? [chips] : []),
    body,
    topbar(payload),
    ...cornerBack(payload),
  );
  fitFeatured(featured);

  if (chips) scrollChips(chips, chipTrack);

  // Scroll after attaching so offsets exist: the focused row to the top, and the tile inside its shelf.
  const card_ = body.querySelector<HTMLElement>(".lib-card.focused");
  if (!card_) {
    if (chips) {
      body.style.scrollBehavior = "smooth";
      body.scrollTop = 0;
      bodyScroll = 0;
    }
    return;
  }
  const block = card_.closest<HTMLElement>(".lf-block")!;
  // The page is redrawn per payload, so each new element starts where the old one was and then moves.
  const top = block.offsetTop;
  body.style.scrollBehavior = "auto";
  body.scrollTop = bodyScroll ?? top;
  void body.offsetHeight;
  body.style.scrollBehavior = "smooth";
  body.scrollTop = top;
  bodyScroll = top;
  const track = card_.closest<HTMLElement>(".lf-track");
  const shelf = track?.parentElement;
  if (track && shelf) {
    const id = block.querySelector(".lib-rowh")!.textContent!;
    const u = designUnit(window.innerWidth, window.innerHeight);
    const prev = shelfScroll.get(id);
    let left = prev ?? 0;
    const edge = GLASS.metrics.library.scrollMarginSearch * u;
    if (card_.offsetLeft < left) left = card_.offsetLeft;
    else if (card_.offsetLeft + card_.offsetWidth + edge > left + shelf.clientWidth)
      left = card_.offsetLeft + card_.offsetWidth + edge - shelf.clientWidth;
    left = Math.max(0, Math.min(left, track.offsetWidth + edge - shelf.clientWidth));
    track.style.transform = `translateX(${-(prev ?? left)}px)`;
    void track.offsetHeight;
    track.style.transition = "transform 0.45s var(--ease)";
    track.style.transform = `translateX(${-left}px)`;
    shelfScroll.set(id, left);
  }
}
