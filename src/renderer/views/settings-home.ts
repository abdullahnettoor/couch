import type { ScreenPayload } from "../../shared/protocol.ts";
import { WALLPAPERS, wallpaperVars } from "../../shared/wallpapers.ts";
import { el, focusable, root } from "./dom.ts";
import { backLink, glassRow } from "./glass.ts";
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
  const full = el("div", "wp-full");
  for (const w of WALLPAPERS) {
    const id = `wp:${w.id}`;
    const tile = el(
      "button",
      `wp-tile${id === payload.focusedId ? " focused" : ""}${home?.wallpaper.kind === "builtin" && home.wallpaper.id === w.id ? " chosen" : ""}`,
      `<span class="wp-swatch"></span><span class="wp-name">${w.label}</span>`,
    );
    setVars(tile, w.id);
    tiles.append(focusable(tile, id));
  }
  const chosen = home?.wallpaper;
  for (const p of home?.pictures ?? []) {
    const id = p.kind === "mac" ? "pic:mac" : `pic:${p.kind}:${p.file}`;
    const inUse =
      chosen?.kind === p.kind &&
      (chosen.kind === "mac" || (chosen as { file?: string }).file === p.file);
    const tile = el(
      "button",
      `wp-tile${id === payload.focusedId ? " focused" : ""}${inUse ? " chosen" : ""}`,
      `<span class="wp-swatch"></span><span class="wp-name"></span>`,
    );
    tile.querySelector<HTMLElement>(".wp-name")!.textContent = p.label;
    if (p.thumb) {
      const swatch = tile.querySelector<HTMLElement>(".wp-swatch")!;
      swatch.style.backgroundImage = `url("${p.thumb}")`;
      swatch.style.backgroundSize = "cover";
      swatch.style.backgroundPosition = "center";
    }
    tiles.append(focusable(tile, id));
    if (id === payload.focusedId) full.textContent = inUse ? `${p.label} ·  In use` : p.label;
  }
  panel?.remove();
  panel = el("div", "wp-panel");
  panel.append(
    backLink("settings"),
    el("h1", "wp-title", "Home"),
    el("h2", "wp-head", "Wallpaper"),
    tiles,
    full,
    glassRow({
      id: "artwork",
      label: "Show artwork behind Resume",
      focused: payload.focusedId === "artwork",
      value: home?.artwork === false ? "Off" : "On",
      chevron: false,
    }),
    ...(home?.pictures
      ? [
          glassRow({
            id: "folder",
            label: "Wallpaper folder",
            focused: payload.focusedId === "folder",
            value: home.folder ?? "",
            chevron: false,
          }),
          glassRow({
            id: "slideshow",
            label: "Slideshow",
            focused: payload.focusedId === "slideshow",
            value: { off: "Off", hour: "Every hour", day: "Every day" }[home.slideshow ?? "off"],
            chevron: false,
          }),
        ]
      : []),
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
