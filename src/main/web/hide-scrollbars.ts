import type { PagePreload } from "./web-app.ts";

/** Scrollbars belong to a desktop browser, not a TV: hide them everywhere on the page; scrolling still works. */
export const HIDE_SCROLLBARS_CSS = "*,html,body{scrollbar-width:none!important}";

export const HIDE_SCROLLBARS_PRELOAD: PagePreload = {
  name: "Hide scrollbars",
  func: `function () {
  try {
    var style = document.createElement("style");
    style.textContent = ${JSON.stringify(HIDE_SCROLLBARS_CSS)};
    (document.head || document.documentElement).appendChild(style);
  } catch (err) {}
}`,
};
