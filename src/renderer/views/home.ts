import { HOME_ITEMS } from "../../shared/home-grid.ts";
import { clockParts } from "../../shared/clock-format.ts";
import { iconSvg } from "../../shared/icons.ts";
import type { LibraryEntry, ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, genreLabels, qrSvg, root } from "./dom.ts";
import { glassPill, topbar } from "./glass.ts";

const YOUTUBE_MARK =
  '<svg class="i" viewBox="0.6 0.6 22.8 22.8"><path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8z" fill="#fff"/><path d="M10 15l5.2-3L10 9z" fill="#e01e1e"/></svg>';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function greeting(date: Date): string {
  const h = date.getHours();
  return h < 5
    ? "Good night"
    : h < 12
      ? "Good morning"
      : h < 17
        ? "Good afternoon"
        : "Good evening";
}

function appTile(id: string, label: string, focused: boolean): HTMLElement {
  const face = id === "youtube" ? YOUTUBE_MARK : iconSvg("folder");
  return focusable(
    el(
      "button",
      `h-app${focused ? " focused" : ""}`,
      `<div class="g-tile ${id}-face">${face}</div><div class="g-cap">${label}</div>`,
    ),
    id,
  );
}

/** Long titles drop one or two sizes before the two-line cut-off. */
export function heroSize(title: string): string {
  if (title.length <= 24) return "s0";
  if (title.length <= 40) return "s1";
  return "s2";
}

function filmTile(v: LibraryEntry, focused: boolean): HTMLElement {
  const tile = el("div", "g-tile h-film-art");
  tile.style.setProperty("--hue", String(v.hue));
  if (v.thumb) tile.style.backgroundImage = `url("${v.thumb}")`;
  if (v.progress) {
    tile.append(
      el("div", "h-prog", `<i style="width:${Math.round(v.progress.fraction * 100)}%"></i>`),
    );
  }
  const cap = el(
    "div",
    "g-cap",
    `${escapeHtml(v.title)}<small class="num">${escapeHtml(v.line ?? v.progress?.left ?? "")}</small>`,
  );
  const node = el("button", `h-app h-film${focused ? " focused" : ""}`);
  node.append(tile, cap);
  return focusable(node, v.path);
}

/** The hero frames live in one persistent layer so a change can cross-fade. */
let view: HTMLElement | undefined;
let bg: HTMLElement | undefined;
let bgKey = "";

function syncBackdrop(videos: LibraryEntry[], hero: LibraryEntry | undefined): void {
  const key = videos.map((v) => `${v.path}|${v.backdrop ?? v.thumb ?? ""}`).join("\n");
  if (key !== bgKey) {
    bgKey = key;
    bg!.replaceChildren(
      ...videos.map((v) => {
        const img = el("div", "h-frame");
        img.dataset.path = v.path;
        img.style.setProperty("--hue", String(v.hue));
        const url = v.backdrop ?? v.thumb;
        if (url) img.style.backgroundImage = `url("${url}")`;
        return img;
      }),
    );
  }
  for (const img of Array.from(bg!.children) as HTMLElement[]) {
    img.classList.toggle("on", img.dataset.path === hero?.path);
  }
}

/** Layers that outlive a render so state changes can cross-fade. */
let ambientBg: HTMLElement | undefined;
let clockEl: HTMLElement | undefined;
let heroEl: HTMLElement | undefined;
let chrome: HTMLElement | undefined;

function heroHtml(hero: LibraryEntry, focused: (id: string) => boolean): HTMLElement[] {
  const meta = [hero.folder, hero.progress?.left].filter(Boolean).map((t) => escapeHtml(t!));
  const text = el(
    "div",
    "h-text",
    `${hero.line ? `<div class="k">${escapeHtml(hero.line)}</div>` : ""}${genreLabels(hero.genres)}<h1 class="${heroSize(hero.title)}">${escapeHtml(hero.title)}</h1>${
      hero.overview ? `<p class="ov">${escapeHtml(hero.overview)}</p>` : ""
    }<div class="m num">${meta.map((t) => `<span>${t}</span>`).join("<span>·</span>")}${
      hero.progress
        ? `<span class="h-bar"><i style="width:${Math.round(hero.progress.fraction * 100)}%"></i></span>`
        : ""
    }</div>`,
  );
  const acts = el("div", "h-acts");
  acts.append(
    glassPill("resume", "Resume", focused("resume"), "play"),
    glassPill("fromstart", "From start", focused("fromstart"), "restart"),
  );
  return [text, acts];
}

export function render(payload: ScreenPayload): void {
  const date = new Date(payload.now);
  const videos = payload.homeVideos ?? [];
  const hero = payload.hero;
  if (!view || root.firstElementChild !== view) {
    view = el("div", "screen-glass home");
    bg = el("div", "h-bg");
    ambientBg = el("div", "h-drift");
    clockEl = el("div", "h-clock");
    heroEl = el("div", "h-hero");
    chrome = el("div", "h-chrome");
    bgKey = "";
    root.replaceChildren(view);
    view.append(ambientBg, bg, clockEl, heroEl, chrome);
  }
  syncBackdrop(videos, hero);
  const focused = (id: string) => payload.focusedId === id;
  view.classList.toggle("empty", videos.length === 0);
  view.classList.toggle("film", !!hero);
  view.classList.toggle("ambient", !!payload.ambient);
  bg!.classList.toggle("on", !!hero);
  heroEl!.classList.toggle("on", !!hero);
  clockEl!.classList.toggle("on", !hero);
  // The last hero stays drawn while it fades out.
  if (hero) heroEl!.replaceChildren(...heroHtml(hero, focused));
  else for (const b of heroEl!.querySelectorAll("[data-id]")) b.classList.remove("focused");
  const { time, suffix } = clockParts(payload.now, payload.timeFormat);
  clockEl!.innerHTML =
    `<div class="t num">${time}${suffix ? `<small>${suffix}</small>` : ""}</div>` +
    `<div class="d">${greeting(date)} · ${date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>`;

  const row = el("div", "h-row");
  for (const app of HOME_ITEMS.filter((i) => i.id !== "settings"))
    row.append(appTile(app.id, app.label, focused(app.id)));
  if (videos.length) {
    row.append(el("div", "h-divider"));
    for (const v of videos) row.append(filmTile(v, focused(v.path)));
  }
  const parts: HTMLElement[] = [topbar(payload), row];
  if (payload.state.remotes === 0) {
    parts.push(
      el(
        "div",
        "h-qr",
        `<div class="qr">${qrSvg(payload.pairingUrl)}</div><div class="c">Scan to use your phone as a remote</div>`,
      ),
    );
  }
  chrome!.replaceChildren(...parts);
}
