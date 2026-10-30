import type { ScreenPayload, ShowEpisode } from "../../shared/protocol.ts";
import { el, focusable, genreLabels, root } from "./dom.ts";
import { cornerBack, glassPill, topbar } from "./glass.ts";

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function row(e: ShowEpisode, focused: boolean): HTMLElement {
  const img = e.thumb
    ? `<img src="${escape(e.thumb)}" alt="">`
    : `<div class="lib-plain" style="--hue:${e.hue}"></div>`;
  const bar = e.progress
    ? `<div class="lib-prog"><i style="width:${Math.round(e.progress.fraction * 100)}%"></i></div>`
    : "";
  const status = e.missing
    ? "Drive not connected"
    : e.watched
      ? "Watched"
      : (e.progress?.left ?? "");
  const num = e.number === undefined ? "" : `<span>${e.number}</span>`;
  const node = el(
    "button",
    `sh-ep${focused ? " focused" : ""}${e.missing ? " missing" : ""}`,
    `<div class="sh-im">${img}${bar}</div><div><h3>${num}${escape(e.title)}</h3>${
      e.overview ? `<p>${escape(e.overview)}</p>` : ""
    }${status ? `<div class="st">${escape(status)}</div>` : ""}</div>`,
  );
  return focusable(node, e.id);
}

interface Page {
  page: HTMLElement;
  bg: HTMLElement;
  side: HTMLElement;
  tabs: HTMLElement;
  wrap: HTMLElement;
  track: HTMLElement;
  key: string;
  offset: number;
}
let shown: Page | undefined;

/** Draws the show page. The page, backdrop and list track persist between renders so scrolling can animate. */
export function render(payload: ScreenPayload): void {
  const show = payload.show;
  if (!show) return;
  if (!shown || root.firstElementChild !== shown.page) {
    const page = el("div", "screen-glass sh-page");
    const bg = el("div", "sh-bg");
    const side = el("div", "sh-side");
    const list = el("div", "sh-list");
    const tabs = el("div", "sh-tabs glass");
    const wrap = el("div", "sh-wrap");
    const track = el("div", "sh-track");
    wrap.append(track);
    list.append(tabs, wrap);
    page.append(bg, side, list);
    root.replaceChildren(page);
    shown = { page, bg, side, tabs, wrap, track, key: "", offset: 0 };
  }
  const p = shown;
  p.bg.style.backgroundImage = show.backdrop ? `url("${show.backdrop}")` : "";

  const reserved = Boolean(show.poster) || show.artExpected;
  p.side.classList.toggle("has-art", reserved);
  p.side.replaceChildren(
    ...(reserved
      ? [el("div", "sh-art", show.poster ? `<img src="${escape(show.poster)}" alt="">` : "")]
      : []),
    el("h1", "", escape(show.name)),
    el("div", "sh-meta", show.meta.map((m) => `<span>${escape(m)}</span>`).join("<i>·</i>")),
    ...(show.genres?.length ? [el("div", "sh-genres", genreLabels(show.genres))] : []),
    ...(show.overview || reserved ? [el("p", "sh-ov", escape(show.overview ?? ""))] : []),
    el("div", "sh-acts"),
  );
  const acts = p.side.querySelector(".sh-acts")!;
  acts.append(glassPill("play", show.primary, payload.focusedId === "play", "play"));
  if (show.canFix) acts.append(glassPill("fix", "Fix match", payload.focusedId === "fix"));

  p.tabs.replaceChildren(
    ...show.tabs.map((t) =>
      focusable(
        el(
          "button",
          `sh-tab${t.selected ? " sel" : ""}${payload.focusedId === `tab:${t.id}` ? " focused" : ""}`,
          escape(t.label),
        ),
        `tab:${t.id}`,
      ),
    ),
  );

  const tab = show.tabs.find((t) => t.selected)?.id ?? "";
  const key = `${show.id}:${tab}`;
  p.track.replaceChildren(
    ...show.episodes.map((e) => row(e, e.id === payload.focusedId)),
    ...(show.episodes.length ? [] : [el("div", "sh-none", "Nothing here yet.")]),
  );

  // Size the window to whole rows, so no half-visible row peeks at the bottom.
  const rows = Array.from(p.track.children) as HTMLElement[];
  p.wrap.style.height = "";
  const first = rows[0];
  if (first) {
    const gap = rows.length > 1 ? rows[1]!.offsetTop - first.offsetTop - first.offsetHeight : 0;
    const pitch = first.offsetHeight + gap;
    const avail = p.wrap.parentElement!.clientHeight - p.tabs.offsetHeight - p.tabs.offsetTop;
    const n = Math.max(1, Math.floor((avail + gap) / pitch));
    p.wrap.style.height = `${n * pitch - gap}px`;
  }

  // Keep the focused row in view, moving by whole rows; a new tab starts at the top without animating.
  const fresh = key !== p.key;
  if (fresh) {
    p.key = key;
    p.offset = 0;
  }
  const focused = p.track.querySelector<HTMLElement>(".sh-ep.focused");
  if (focused) {
    const height = p.wrap.clientHeight;
    if (focused.offsetTop < p.offset) p.offset = focused.offsetTop;
    else if (focused.offsetTop + focused.offsetHeight > p.offset + height) {
      p.offset =
        rows.find((r) => r.offsetTop + height >= focused.offsetTop + focused.offsetHeight)
          ?.offsetTop ?? focused.offsetTop;
    }
  }
  p.track.classList.toggle("still", fresh);
  p.track.style.transform = `translateY(${-p.offset}px)`;
  if (fresh) void p.track.offsetHeight;
  p.page.querySelector(".topbar")?.remove();
  p.page.querySelector(".g-back")?.remove();
  p.page.append(topbar(payload), cornerBack(show.backTo ?? "Library", payload));
}
