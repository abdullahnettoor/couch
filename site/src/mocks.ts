/**
 * The product mocks, built from Couch's real UI (src/couch-ui/, copied by scripts/sync-couch-ui.mjs).
 * Only the markup lives here: it follows how src/renderer/views/home.ts, glass.ts and library.ts draw their
 * elements (same tags, classes and order), filled with made-up content. Colours, sizes, focus and motion
 * come from the copied CSS. Read by vite.config.ts at build time (node), never shipped as script.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import data from "./couch-ui/data.json" with { type: "json" };

type App = { id: string; label: string; symbol?: string; viewBox?: string; svg?: string };
const apps = data.apps as App[];
const icons = data.icons as Record<string, string>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const icon = (name: string) => `<svg class="i" viewBox="0 0 256 256" aria-hidden="true">${icons[name]}</svg>`;
const mark = (a: App) => (a.symbol ? `<svg class="i" aria-hidden="true"><use href="#${a.symbol}"/></svg>` : a.svg!);

/** The App marks, once: every tile and Remote button refers to them with <use>. */
export function sprite(): string {
  const sym = Object.entries(data.sprite as Record<string, string>)
    .map(([id, inner]) => `<symbol id="cu-${id}" viewBox="${apps.find((a) => a.id === id)!.viewBox}">${inner}</symbol>`)
    .join("");
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${sym}</svg>`;
}

const vars = Object.entries(data.wallpaper.vars)
  .map(([k, v]) => `${k}:${v}`)
  .join(";");

/** An illustrative QR code (not a real one), drawn as Couch's qrSvg() draws a real one: 4 modules of white margin, dark modules on white. */
const QR_PATH = "M0 0h7v1h-7zM9 0h1v1h-1zM16 0h1v1h-1zM18 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM9 1h2v1h-2zM12 1h4v1h-4zM18 1h1v1h-1zM24 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM11 2h1v1h-1zM14 2h1v1h-1zM16 2h1v1h-1zM18 2h1v1h-1zM20 2h3v1h-3zM24 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM9 3h2v1h-2zM18 3h1v1h-1zM20 3h3v1h-3zM24 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h3v1h-3zM12 4h2v1h-2zM15 4h1v1h-1zM18 4h1v1h-1zM20 4h3v1h-3zM24 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM9 5h2v1h-2zM12 5h2v1h-2zM16 5h1v1h-1zM18 5h1v1h-1zM24 5h1v1h-1zM0 6h7v1h-7zM10 6h1v1h-1zM12 6h2v1h-2zM16 6h1v1h-1zM18 6h7v1h-7zM8 7h3v1h-3zM12 7h2v1h-2zM1 8h1v1h-1zM3 8h1v1h-1zM6 8h2v1h-2zM9 8h2v1h-2zM13 8h2v1h-2zM16 8h2v1h-2zM19 8h1v1h-1zM21 8h1v1h-1zM24 8h1v1h-1zM0 9h1v1h-1zM2 9h3v1h-3zM6 9h4v1h-4zM11 9h1v1h-1zM17 9h2v1h-2zM20 9h1v1h-1zM2 10h1v1h-1zM5 10h2v1h-2zM10 10h5v1h-5zM17 10h1v1h-1zM19 10h2v1h-2zM0 11h1v1h-1zM2 11h1v1h-1zM4 11h2v1h-2zM7 11h1v1h-1zM9 11h2v1h-2zM12 11h1v1h-1zM15 11h1v1h-1zM17 11h1v1h-1zM20 11h1v1h-1zM24 11h1v1h-1zM1 12h2v1h-2zM5 12h1v1h-1zM7 12h4v1h-4zM14 12h2v1h-2zM17 12h4v1h-4zM23 12h1v1h-1zM0 13h1v1h-1zM2 13h1v1h-1zM4 13h3v1h-3zM8 13h1v1h-1zM10 13h4v1h-4zM15 13h1v1h-1zM17 13h5v1h-5zM1 14h2v1h-2zM6 14h1v1h-1zM9 14h5v1h-5zM20 14h1v1h-1zM4 15h1v1h-1zM12 15h1v1h-1zM14 15h1v1h-1zM16 15h1v1h-1zM18 15h1v1h-1zM21 15h3v1h-3zM0 16h4v1h-4zM7 16h1v1h-1zM11 16h1v1h-1zM14 16h6v1h-6zM12 17h3v1h-3zM17 17h2v1h-2zM23 17h2v1h-2zM0 18h7v1h-7zM8 18h1v1h-1zM11 18h1v1h-1zM13 18h3v1h-3zM18 18h3v1h-3zM23 18h2v1h-2zM0 19h1v1h-1zM6 19h1v1h-1zM8 19h1v1h-1zM10 19h1v1h-1zM13 19h1v1h-1zM0 20h1v1h-1zM2 20h3v1h-3zM6 20h1v1h-1zM8 20h2v1h-2zM14 20h1v1h-1zM16 20h1v1h-1zM19 20h1v1h-1zM22 20h1v1h-1zM24 20h1v1h-1zM0 21h1v1h-1zM2 21h3v1h-3zM6 21h1v1h-1zM8 21h2v1h-2zM12 21h1v1h-1zM16 21h1v1h-1zM18 21h2v1h-2zM21 21h3v1h-3zM0 22h1v1h-1zM2 22h3v1h-3zM6 22h1v1h-1zM12 22h1v1h-1zM14 22h3v1h-3zM18 22h4v1h-4zM0 23h1v1h-1zM6 23h1v1h-1zM8 23h1v1h-1zM10 23h3v1h-3zM14 23h1v1h-1zM19 23h6v1h-6zM0 24h7v1h-7zM9 24h3v1h-3zM13 24h3v1h-3zM18 24h2v1h-2zM21 24h2v1h-2z";
export const qrSvg = `<svg viewBox="-2 -2 29 29" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width="100%" height="100%" fill="#fff"/><path d="${QR_PATH}" fill="#16130f"/></svg>`;

const CLOCK = { time: "8:42", suffix: "PM" };
const DATE = "Good evening · Monday 2 November";

interface Film { title: string; hue: number; left: number; line: string; folder: string }
const films: Film[] = [
  { title: "Summer Trip", hue: 24, left: 0.62, line: "1h 12m left", folder: "Holidays" },
  { title: "Cooking Show", hue: 205, left: 0.18, line: "38m left", folder: "Shows" },
];

export interface HomeOptions {
  alt: string;
  /** "empty": the clock and the three App tiles. "film": the hero frame and the Continue row. */
  layout: "empty" | "film";
  /** The App tile (or "resume") that has focus. */
  focus: string;
  /** Pairing state: the QR card and "No phone connected" (CSS swaps them for the paired state). */
  qr?: boolean;
  /** Only the hero lets the wallpaper drift (Couch's 90s drift); the others hold still. */
  drift?: boolean;
}

function appTile(a: App, focused: boolean): string {
  return `<div class="h-app${focused ? " focused" : ""}" data-id="${a.id}"><div class="g-tile ${a.id}-face">${mark(a)}</div><div class="g-cap">${esc(a.label)}</div></div>`;
}

function filmTile(f: Film, i: number): string {
  return `<div class="h-app h-film" data-id="film${i}"><div class="g-tile h-film-art" style="--hue:${f.hue}" data-art="${i}"><div class="h-prog"><i style="width:${Math.round(f.left * 100)}%"></i></div></div><div class="g-cap">${esc(f.title)}<small class="num">${esc(f.line)}</small></div></div>`;
}

export function home(o: HomeOptions): string {
  const film = o.layout === "film";
  const hero = films[0]!;
  const pill = (label: string, glyph: string, focused: boolean) =>
    `<div class="g-pill${focused ? " focused" : ""}" data-id="${glyph}">${icon(glyph)}${label}</div>`;
  const row =
    apps.map((a) => appTile(a, o.focus === a.id)).join("") +
    (film ? `<div class="h-divider"></div>${films.map(filmTile).join("")}` : "");
  const frames = film
    ? films.map((f, i) => `<div class="h-frame${i === 0 ? " on" : ""}" style="--hue:${f.hue}" data-art="${i}"></div>`).join("")
    : "";
  const heroHtml = film
    ? `<div class="h-text"><h1 class="s0">${esc(hero.title)}</h1><div class="m num"><span>${hero.folder}</span><span>·</span><span>${hero.line}</span><span class="h-bar"><i style="width:${Math.round(hero.left * 100)}%"></i></span></div></div><div class="h-acts">${pill("Resume", "play", o.focus === "resume")}${pill("From start", "restart", false)}</div>`
    : "";
  const phones = o.qr
    ? `<span class="ph-off">No phone connected</span><span class="ph-on">1 phone connected</span>`
    : "1 phone connected";
  const topbar = `<div class="topbar"><div class="phones${o.qr ? " none" : ""}"><i></i>${phones}</div><div class="tb-gear">${icon("gear")}</div><div class="clock num">${CLOCK.time}<small>${CLOCK.suffix}</small></div></div>`;
  const qr = o.qr
    ? `<div class="h-qr"><div class="qr">${qrSvg}</div><div class="c">Scan to use your phone as a remote</div></div>`
    : "";
  return `<div class="cu" role="img" aria-label="${esc(o.alt)}" inert><div class="screen-glass home ${film ? "film" : "empty"}${o.drift ? "" : " still"}" style="${vars}"><div class="h-drift"></div><div class="h-scrim"></div><div class="h-bg${film ? " on" : ""}">${frames}</div><div class="h-clock${film ? "" : " on"}"><div class="t num">${CLOCK.time}<small>${CLOCK.suffix}</small></div><div class="d">${DATE}</div></div><div class="h-hero${film ? " on" : ""}">${heroHtml}</div><div class="h-chrome">${topbar}<div class="h-row">${row}</div>${qr}</div></div></div>`;
}

/** The Library shelf as Couch's own cards draw it: a folder card, then the videos. */
export function shelf(): string {
  const card = (title: string, small: string, hue: number, extra: string, focused = false) =>
    `<div class="lib-card wide${focused ? " focused" : ""}"><div class="g-tile"><div class="lib-plain" style="--hue:${hue}"></div>${extra}</div><div class="g-cap">${esc(title)}<small>${esc(small)}</small></div></div>`;
  const prog = (f: number) => `<div class="lib-prog"><i style="width:${Math.round(f * 100)}%"></i></div>`;
  const plain = (h: number) => `<div class="lib-plain" style="--hue:${h}"></div>`;
  const folder = `<div class="lib-card wide"><div class="g-tile"><div class="lib-mosaic">${[24, 205, 130, 330].map(plain).join("")}</div></div><div class="g-cap">Movies<small>4 items</small></div></div>`;
  const arrow = `<svg class="i shelf-arrow" viewBox="0 0 256 256" aria-hidden="true"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg>`;
  return `<div class="cu shelf-cu" role="img" aria-label="A folder named Movies becomes a shelf of videos: Summer Trip and Cooking Show part-watched, Home Videos watched" inert>${folder}${arrow}${card("Summer Trip", "1h 12m left · Holidays", 24, prog(0.62), true)}${card("Cooking Show", "38m left · Shows", 205, prog(0.18))}${card("Home Videos", "Watched", 130, '<span class="lib-badge">Watched</span>')}</div>`;
}

const remoteHtml = readFileSync(resolve(import.meta.dirname, "couch-ui/remote.html"), "utf8").replace(/^<!--[\s\S]*?-->\n/, "");

/** The Remote's idle view as the phone shows it, plus (optionally) the phone camera view over it. */
export function remote(alt: string, scan: boolean): string {
  const appRow = apps
    .map(
      (a) =>
        `<button type="button" class="app" data-cmd="openApp" aria-label="Open ${esc(a.label)}"><span class="ic">${mark(a)}</span><span class="n">${esc(a.label)}</span></button>`,
    )
    .join("");
  const body = remoteHtml.replace("__APPS__", appRow);
  const cam = scan
    ? `<div class="mock-scan" aria-hidden="true"><div class="s-frame"><i></i><i></i><i></i><i></i></div><span>Point the camera at the code on the Screen</span></div>`
    : "";
  return `<div class="cr idle" role="img" aria-label="${esc(alt)}" inert>${body}</div>${cam}`;
}
