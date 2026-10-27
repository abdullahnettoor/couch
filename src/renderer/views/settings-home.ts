import type { ScreenPayload } from "../../shared/protocol.ts";
import { WALLPAPERS, wallpaperVars } from "../../shared/wallpapers.ts";
import { el, focusable, root } from "./dom.ts";
import { glassRow, splitPage } from "./glass.ts";

function setVars(node: HTMLElement, id: string): void {
  for (const [name, value] of Object.entries(wallpaperVars(id)))
    node.style.setProperty(name, value);
}

/** Settings → Home: wallpaper preview tiles (the page itself shows the one in focus) and the artwork switch. */
export function render(payload: ScreenPayload): void {
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
  splitPage({ icon: "gear" }, [
    el("h1", "", "Home"),
    el("h2", "wp-head", "Wallpaper"),
    tiles,
    glassRow({
      id: "artwork",
      label: "Show artwork behind Resume",
      focused: payload.focusedId === "artwork",
      value: home?.artwork === false ? "Off" : "On",
      chevron: false,
    }),
  ]);
  const page = root.firstElementChild as HTMLElement | null;
  if (page) {
    page.classList.add("wp-page");
    setVars(page, home?.wallpaper.id ?? "");
  }
}
