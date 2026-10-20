import { HOME_ITEMS } from "../../shared/home-grid.ts";
import { iconSvg } from "../../shared/icons.ts";
import type { LibraryEntry, ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, qrSvg, root } from "./dom.ts";
import { glassPill, topbar } from "./glass.ts";

const YOUTUBE_MARK =
  '<svg class="i" viewBox="0 0 24 24"><path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8z" fill="#fff"/><path d="M10 15l5.2-3L10 9z" fill="#e01e1e"/></svg>';

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
    `${escapeHtml(v.title)}<small class="num">${escapeHtml(v.progress?.left ?? "")}</small>`,
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
  const key = videos.map((v) => `${v.path}|${v.thumb ?? ""}`).join("\n");
  if (key !== bgKey) {
    bgKey = key;
    bg!.replaceChildren(
      ...videos.map((v) => {
        const img = el("div", "h-frame");
        img.dataset.path = v.path;
        img.style.setProperty("--hue", String(v.hue));
        if (v.thumb) img.style.backgroundImage = `url("${v.thumb}")`;
        return img;
      }),
    );
  }
  for (const img of Array.from(bg!.children) as HTMLElement[]) {
    img.classList.toggle("on", img.dataset.path === hero?.path);
  }
}

export function render(payload: ScreenPayload): void {
  const date = new Date(payload.now);
  const videos = payload.homeVideos ?? [];
  const hero = payload.hero;
  if (!view || root.firstElementChild !== view) {
    view = el("div", "screen-glass home");
    bg = el("div", "h-bg");
    bgKey = "";
    root.replaceChildren(view);
  }
  syncBackdrop(videos, hero);
  const focused = (id: string) => payload.focusedId === id;
  const parts: HTMLElement[] = [bg!, topbar(payload)];
  const row = el("div", "h-row");
  const apps = HOME_ITEMS.filter((i) => i.id !== "settings");

  if (hero) {
    view.classList.remove("empty");
    const meta = [hero.folder, hero.progress?.left].filter(Boolean).map((t) => escapeHtml(t!));
    parts.push(
      el(
        "div",
        "h-hero",
        `<h1>${escapeHtml(hero.title)}</h1><div class="m num">${meta
          .map((t) => `<span>${t}</span>`)
          .join("<span>·</span>")}${
          hero.progress
            ? `<span class="h-bar"><i style="width:${Math.round(hero.progress.fraction * 100)}%"></i></span>`
            : ""
        }</div>`,
      ),
    );
    const acts = el("div", "h-acts");
    acts.append(
      glassPill("resume", "Resume", focused("resume"), "play"),
      glassPill("fromstart", "From start", focused("fromstart"), "restart"),
    );
    parts[parts.length - 1]!.append(acts);
    for (const app of apps) row.append(appTile(app.id, app.label, focused(app.id)));
    row.append(el("div", "h-divider"));
    for (const v of videos) row.append(filmTile(v, focused(v.path)));
  } else {
    view.classList.add("empty");
    parts.push(
      el(
        "div",
        "h-clock",
        `<div class="t num">${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/i, "")}</div>` +
          `<div class="d">${greeting(date)} · ${date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>`,
      ),
    );
    for (const app of apps) row.append(appTile(app.id, app.label, focused(app.id)));
  }
  parts.push(row);
  if (payload.state.remotes === 0) {
    parts.push(
      el(
        "div",
        "h-qr",
        `<div class="qr">${qrSvg(payload.pairingUrl)}</div><div class="c">Scan to use your phone as a remote</div>`,
      ),
    );
  }
  view.replaceChildren(...parts);
}
