import type { PagePreload } from "../../web/web-app.ts";

const KEY = "couchNfArt";

/**
 * Netflix's player sets no media-session artwork and its watch page holds none, so the box art is
 * taken from the card the household opened the title from: this runs in the page, remembers each
 * clicked card's image by title id (and the last one, for an episode whose id isn't the card's)
 * in sessionStorage, and survives Netflix's page changes.
 */
export const NETFLIX_ART_PRELOAD: PagePreload = {
  name: "Netflix box art",
  func: `function () {
  document.addEventListener("click", function (e) {
    try {
      var a = e.target && e.target.closest && e.target.closest('a[href*="jbv="], a[href*="/title/"], a[href*="/watch/"]');
      if (!a) return;
      var m = /(?:jbv=|\\/title\\/|\\/watch\\/)(\\d+)/.exec(a.getAttribute("href") || "");
      var img = a.querySelector("img");
      if (!m || !img || String(img.src).indexOf("https:") !== 0) return;
      var s = JSON.parse(sessionStorage.getItem("${KEY}") || "{}");
      if (Object.keys(s).length > 30) s = {};
      s[m[1]] = img.src;
      s.last = img.src;
      sessionStorage.setItem("${KEY}", JSON.stringify(s));
    } catch (err) {}
  }, true);
}`,
};

/** The remembered box art for the title on the player, else for the card opened last. */
export const NETFLIX_ARTWORK = `(function () {
  try {
    var s = JSON.parse(sessionStorage.getItem("${KEY}") || "{}");
    var m = /^\\/watch\\/(\\d+)/.exec(location.pathname);
    return (m && s[m[1]]) || s.last || null;
  } catch (e) { return null; }
})()`;
