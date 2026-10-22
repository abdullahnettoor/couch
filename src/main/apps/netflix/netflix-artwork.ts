import type { PagePreload } from "../../web/web-app.ts";

const KEY = "couchNfArt";

/**
 * Netflix's player sets no media-session artwork and its watch page holds none, so the box art is
 * taken from where the household started the title. This runs in the page and keeps, in
 * sessionStorage (it survives Netflix's page changes), the art of each title id it can tie to a
 * click: a card (its image), a /watch/<id> link (its own image, else the open pop-up's card art or
 * the billboard's image), and a Play button whose title id is only known once the player opens
 * (it waits briefly for the next /watch/<id>). A series' episodes take the art of the pop-up they
 * were clicked in. Art that can't be tied to the playing title is never guessed.
 */
export const NETFLIX_ART_PRELOAD: PagePreload = {
  name: "Netflix box art",
  func: `function () {
  var KEY = "${KEY}";
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function https(src) { return typeof src === "string" && src.indexOf("https:") === 0 ? src : null; }
  function biggest(root) {
    var best = null, area = -1;
    Array.prototype.forEach.call(root.querySelectorAll("img"), function (img) {
      if (!https(img.src)) return;
      var r = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0 };
      if (r.width * r.height > area) { best = img.src; area = r.width * r.height; }
    });
    return best;
  }
  document.addEventListener("click", function (e) {
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      var s = load();
      if (Object.keys(s).length > 30) s = {};
      var dialog = t.closest('[role="dialog"]');
      var billboard = t.closest('[data-uia="billboard"]');
      var a = t.closest('a[href*="jbv="], a[href*="/title/"], a[href*="/watch/"]');
      var m = a && /(jbv=|\\/title\\/|\\/watch\\/)(\\d+)/.exec(a.getAttribute("href") || "");
      var own = a && a.querySelector("img");
      own = own && https(own.src);
      var around = dialog ? s.open : billboard ? biggest(billboard) : null;
      delete s.pending;
      if (m) {
        var art = own || around;
        if (art) s[m[2]] = art;
        if (m[1] !== "/watch/") { if (own) s.open = own; else delete s.open; }
      } else if (t.closest('[data-uia="play-video-button"]')) {
        if (around) s.pending = { art: around, at: Date.now() };
      } else if (!dialog) {
        delete s.open;
      }
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch (err) {}
  }, true);
}`,
};

/** The remembered box art for the title on the player: what its own click recorded, else a Play click just before it. */
export const NETFLIX_ARTWORK = `(function () {
  try {
    var s = JSON.parse(sessionStorage.getItem("${KEY}") || "{}");
    var m = /^\\/watch\\/(\\d+)/.exec(location.pathname);
    if (!m) return null;
    if (s[m[1]]) return s[m[1]];
    if (s.pending && Date.now() - s.pending.at < 30000) {
      s[m[1]] = s.pending.art;
      delete s.pending;
      sessionStorage.setItem("${KEY}", JSON.stringify(s));
      return s[m[1]];
    }
    return null;
  } catch (e) { return null; }
})()`;
