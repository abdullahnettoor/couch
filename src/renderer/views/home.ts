import { clockParts } from "../../shared/clock-format.ts";
import type { LibraryEntry, ScreenPayload } from "../../shared/protocol.ts";
import { el, focusable, genreLabels, qrSvg, root } from "./dom.ts";
import { glassPill, topbar } from "./glass.ts";
import { photoVars, wallpaperVars, type PictureTile } from "../../shared/wallpapers.ts";
import type { WallpaperChoice } from "../../shared/wallpapers.ts";
import { planPhoto, type Photo } from "../photo-plan.ts";

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

function appTile(id: string, label: string, icon: string, focused: boolean): HTMLElement {
  const face = icon;
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
  if (v.app) tile.append(el("span", `h-badge ${v.app.id}-face`, v.app.icon));
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

/** The converted picture a choice points at, once it is ready to draw. */
export function pictureFor(
  pictures: PictureTile[] | undefined,
  choice: WallpaperChoice,
): PictureTile | undefined {
  if (choice.kind === "builtin") return undefined;
  return pictures?.find(
    (p) => p.kind === choice.kind && (choice.kind === "mac" || p.file === choice.file),
  );
}

const FADE_MS = 2500;

/** The picture on screen, and the one being loaded for it. */
let shownPhoto: Photo | undefined;
let loadingUrl = "";

function showPhoto(choice: "builtin" | "picture", ready: Photo | undefined): void {
  const plan = planPhoto(shownPhoto, choice, ready);
  const v = view!;
  if (plan === "clear") {
    shownPhoto = undefined;
    loadingUrl = "";
    for (const name of ["--wp-photo", "--wp-dim"]) v.style.removeProperty(name);
    v.classList.remove("photo");
  } else if (plan === "load" && ready && loadingUrl !== ready.url) {
    loadingUrl = ready.url;
    const image = new Image();
    const apply = () => {
      if (loadingUrl !== ready.url || view !== v) return;
      const before = v.style.getPropertyValue("--wp-photo");
      for (const [name, value] of Object.entries(photoVars(ready)))
        v.style.setProperty(name, value);
      v.classList.add("photo");
      if (before && shownPhoto) fadeFrom(before);
      shownPhoto = ready;
    };
    image.onload = apply;
    // A picture that can't be loaded leaves the current one on screen.
    image.onerror = () => {
      if (loadingUrl === ready.url) loadingUrl = "";
    };
    image.src = ready.url;
  }
}

/** A slow crossfade: the picture that was showing stays over the new one and fades out. */
function fadeFrom(previous: string): void {
  const layer = photoEl?.querySelector<HTMLElement>(".h-photo-img");
  if (!layer) return;
  const old = document.createElement("i");
  old.className = "h-photo-img h-photo-prev";
  old.style.backgroundImage = previous;
  layer.after(old);
  requestAnimationFrame(() => (old.style.opacity = "0"));
  setTimeout(() => old.remove(), FADE_MS + 200);
}

/** Layers that outlive a render so state changes can cross-fade. */
let ambientBg: HTMLElement | undefined;
let photoEl: HTMLElement | undefined;
let scrim: HTMLElement | undefined;
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
  acts.append(glassPill("resume", "Resume", focused("resume"), "play"));
  if (hero.app?.fromStart !== false)
    acts.append(glassPill("fromstart", "From start", focused("fromstart"), "restart"));
  return [text, acts];
}

export function render(payload: ScreenPayload): void {
  const date = new Date(payload.now);
  const videos = payload.homeVideos ?? [];
  const hero = payload.hero;
  root.querySelector(".wp-panel")?.remove();
  if (!view || root.firstElementChild !== view) {
    view = el("div", "screen-glass home");
    bg = el("div", "h-bg");
    ambientBg = el("div", "h-drift");
    photoEl = el(
      "div",
      "h-photo",
      '<i class="h-photo-img"></i><i class="h-photo-dim"></i><i class="h-photo-blur top"></i><i class="h-photo-blur bottom"></i>',
    );
    scrim = el("div", "h-scrim");
    clockEl = el("div", "h-clock");
    heroEl = el("div", "h-hero");
    chrome = el("div", "h-chrome");
    bgKey = "";
    shownPhoto = undefined;
    loadingUrl = "";
    root.replaceChildren(view);
    view.append(ambientBg, photoEl, scrim, bg, clockEl, heroEl, chrome);
  }
  syncBackdrop(videos, hero);
  const focused = (id: string) => payload.focusedId === id;
  view.classList.toggle("empty", videos.length === 0);
  view.classList.toggle("film", !!hero);
  view.classList.toggle("ambient", !!payload.ambient);
  view.classList.toggle("setup", !!payload.setup);
  view.classList.toggle("no-art", payload.home?.artwork === false);
  // Under the Wallpaper page's blurred panel a moving Home is re-blurred every frame; hold it still there.
  view.classList.toggle("still", payload.state.view === "settingsHome");
  const choice = payload.home?.preview ?? payload.home?.wallpaper;
  const tile = choice && pictureFor(payload.home?.pictures, choice);
  const ready = tile?.url && tile.dim !== undefined ? { url: tile.url, dim: tile.dim } : undefined;
  showPhoto(choice?.kind === "builtin" || !choice ? "builtin" : "picture", ready);
  for (const [name, value] of Object.entries(
    wallpaperVars(choice?.kind === "builtin" ? choice.id : ""),
  ))
    view.style.setProperty(name, value);
  bg!.classList.toggle("on", !!hero && payload.home?.artwork !== false);
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
  for (const app of (payload.homeApps ?? []).filter((a) => a.shown))
    row.append(appTile(app.id, app.label, app.icon, focused(app.id)));
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
