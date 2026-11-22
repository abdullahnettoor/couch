import { TYPICAL_TARGET_WIDTH, textZoom, type TextSize } from "../shared/text-size.ts";

/**
 * The Text size step's sample: Couch's own made-up page of a music site, in a plain website style on
 * purpose (not the Look), so the household judges the size as an App's page will look. It lives in a
 * shadow root with its own styles, as a site's page does, and Couch's styles can't reach it.
 */
const SITE_CSS = `
:host { all: initial; display: block; }
* { box-sizing: border-box; margin: 0; }
.page { background: #121212; color: #f2f2f2; font: 14px/1.4 -apple-system, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
header { display: flex; align-items: center; gap: 24px; padding: 14px 32px; border-bottom: 1px solid #262626; }
.logo { width: 28px; height: 28px; border-radius: 7px; background: linear-gradient(135deg, #f5a524, #e0457b); }
nav { display: flex; gap: 20px; color: #a3a3a3; }
nav b { color: #f2f2f2; font-weight: 600; }
.search { margin-left: auto; width: 280px; height: 34px; border-radius: 17px; background: #242424; color: #8a8a8a; font-size: 13px; padding: 8px 16px; white-space: nowrap; }
main { padding: 24px 32px 32px; }
h2 { font-size: 20px; font-weight: 700; margin-bottom: 2px; }
.lede { font-size: 13px; color: #9a9a9a; margin-bottom: 14px; }
.row { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); grid-template-rows: auto; grid-auto-rows: 0; column-gap: 20px; overflow: hidden; }
.art { aspect-ratio: 16 / 9; border-radius: 6px; margin-bottom: 10px; }
.card .t { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .s { font-size: 12px; color: #9a9a9a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card.focus .art { outline: 3px solid rgba(255, 255, 255, 0.95); outline-offset: 6px; }
section + section { margin-top: 30px; }
.list { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 32px; }
.song { display: flex; align-items: center; gap: 12px; padding: 6px 8px; }
.song i { width: 40px; height: 40px; border-radius: 4px; flex: none; }
.song .t { font-size: 14px; }
.song .s, .song .d { font-size: 12px; color: #9a9a9a; }
.song .d { margin-left: auto; }
`;

const CARDS: Array<[string, string, number]> = [
  ["Evening Drive", "Mix · Lane Harbor, Ostra", 18],
  ["Low Tide", "Album · Marisol Vey", 205],
  ["Paper Lanterns", "Album · The Quiet Hours", 330],
  ["Northern Static", "Single · Ivo Brandt", 160],
  ["Kitchen Radio", "Playlist · 48 songs", 45],
  ["Slow Mornings", "Mix · Ada Kline, June Ro", 265],
  ["Field Notes", "Album · Teodor Lisk", 0],
  ["Glass Harbour", "EP · Nell & the Wires", 185],
  ["Sunday Rooms", "Playlist · 32 songs", 95],
];
const SONGS: Array<[string, string, string]> = [
  ["Harbour Lights", "Marisol Vey · Low Tide", "3:41"],
  ["Second Floor", "Ivo Brandt", "4:02"],
  ["Wires", "Nell & the Wires · Glass Harbour", "2:58"],
  ["Morning Static", "Ada Kline", "3:15"],
];

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function sitePage(): HTMLElement {
  const page = node("div", "page");
  const header = node("header");
  const nav = node("nav");
  nav.append(node("b", "", "Home"), node("span", "", "Explore"), node("span", "", "Library"));
  header.append(node("div", "logo"), nav, node("div", "search", "Search songs, albums, artists"));
  const made = node("section");
  const row = node("div", "row");
  CARDS.forEach(([title, line, hue], i) => {
    const card = node("div", i === 1 ? "card focus" : "card");
    const art = node("div", "art");
    art.style.background = `linear-gradient(140deg, hsl(${hue} 55% 46%), hsl(${hue + 40} 50% 22%))`;
    card.append(art, node("div", "t", title), node("div", "s", line));
    row.append(card);
  });
  made.append(
    node("h2", "", "Made for you"),
    node("p", "lede", "Albums and mixes picked from what you play"),
    row,
  );
  const picks = node("section");
  const list = node("div", "list");
  SONGS.forEach(([title, line, time], i) => {
    const song = node("div", "song");
    const swatch = node("i");
    swatch.style.background = `hsl(${CARDS[i]![2]} 45% 38%)`;
    const words = node("div");
    words.append(node("div", "t", title), node("div", "s", line));
    song.append(swatch, words, node("span", "d", time));
    list.append(song);
  });
  picks.append(node("h2", "", "Quick picks"), list);
  const main = node("main");
  main.append(made, picks);
  page.append(header, main);
  return page;
}

/**
 * The sample's window: a crop of the page at true scale, the zoom a typical App gets on this Screen at
 * that size. The page is laid out at the width such an App sees (the window's width over the zoom) and
 * scrolled to its first row of cards, whose heading sits at the top of the crop at every size.
 */
export function textSizeSample(): { el: HTMLElement; show(size: TextSize): void } {
  const el = node("div", "s-sample");
  const site = node("div", "s-site");
  const root = site.attachShadow({ mode: "open" });
  const style = node("style");
  style.textContent = SITE_CSS;
  const page = sitePage();
  root.append(style, page);
  el.append(site);
  el.setAttribute("aria-hidden", "true");
  let size: TextSize = "default";
  let placed = false;
  const fit = () => {
    const zoom = textZoom(innerWidth, TYPICAL_TARGET_WIDTH, size);
    page.style.zoom = String(zoom);
    page.style.width = `${innerWidth / zoom}px`;
    if (!el.isConnected) {
      if (placed) removeEventListener("resize", fit);
      return;
    }
    placed = true;
    const top = root.querySelector("main h2")!.getBoundingClientRect().top;
    el.scrollTop = top - el.getBoundingClientRect().top + el.scrollTop - 16 * zoom;
  };
  addEventListener("resize", fit);
  return {
    el,
    show(next) {
      size = next;
      fit();
      // Laid out only once on the page: measure again then.
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(fit);
    },
  };
}
