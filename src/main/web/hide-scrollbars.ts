/** Scrollbars belong to a desktop browser, not a TV: hidden everywhere on the page; scrolling still works. */
export const HIDE_SCROLLBARS_CSS = "*,html,body{scrollbar-width:none!important}";

/** The same, for an engine with no way to insert a user style: a script of the page that adopts a style sheet (the CSP cannot refuse it). WebKit's older `::-webkit-scrollbar` is covered too. */
export const HIDE_SCROLLBARS_SCRIPT = `function () {
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(${JSON.stringify(HIDE_SCROLLBARS_CSS + "::-webkit-scrollbar{display:none!important}")});
    document.adoptedStyleSheets = Array.prototype.concat.call([], document.adoptedStyleSheets || [], [sheet]);
  } catch (e) {}
}`;
