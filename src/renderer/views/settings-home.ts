import type { ScreenPayload } from "../../shared/protocol.ts";
import { WALLPAPERS, wallpaperVars } from "../../shared/wallpapers.ts";
import { el, focusable, root } from "./dom.ts";
import { glassRow } from "./glass.ts";
import * as homeView from "./home.ts";

function setVars(node: HTMLElement, id: string): void {
  for (const [name, value] of Object.entries(wallpaperVars(id)))
    node.style.setProperty(name, value);
}

let panel: HTMLElement | undefined;

/** Settings → Home: the real Home stays mounted (showing the preview wallpaper); a glass panel over its lower half holds the tiles and the artwork switch. */
export function render(payload: ScreenPayload): void {
  homeView.render(payload);
  const home = payload.home;
  const tiles = el("div", "wp-tiles");
  for (const w of WALLPAPERS) {
    const id = `wp:${w.id}`;
    const tile = el(
      "button",
      `wp-tile${id === payload.focusedId ? " focused" : ""}${home?.wallpaper.id === w.id ? " chosen" : ""}`,
      `<span class="wp-swatch"></span><span class="wp-name">${w.label}</span>`,
    );
    setVars(tile, w.id);
    tiles.append(focusable(tile, id));
  }
  panel?.remove();
  panel = el("div", "wp-panel");
  panel.append(
    el("h1", "wp-title", "Home"),
    el("h2", "wp-head", "Wallpaper"),
    tiles,
    glassRow({
      id: "artwork",
      label: "Show artwork behind Resume",
      focused: payload.focusedId === "artwork",
      value: home?.artwork === false ? "Off" : "On",
      chevron: false,
    }),
  );
  root.append(panel);
  const focused = tiles.querySelector<HTMLElement>(".wp-tile.focused");
  if (focused) {
    const edge = 20;
    if (focused.offsetLeft < tiles.scrollLeft) tiles.scrollLeft = focused.offsetLeft - edge;
    else if (focused.offsetLeft + focused.offsetWidth > tiles.scrollLeft + tiles.clientWidth)
      tiles.scrollLeft = focused.offsetLeft + focused.offsetWidth + edge - tiles.clientWidth;
  }
}
