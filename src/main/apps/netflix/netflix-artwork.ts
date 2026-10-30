import type { PagePreload } from "../../web/web-app.ts";

const KEY = "couchNfArt";
const SEEN = "couchNfSeen";
const TITLES = "couchNfTitles";
const SEEN_CAP = 300;

/**
 * Netflix's player sets no media-session artwork and its watch page holds none, so the box art is
 * taken from where the household started the title. This runs in the page and keeps, in
 * sessionStorage (it survives Netflix's page changes), the art of each title id it can tie to a
 * click: a card (its image), a /watch/<id> link (its own image, else the open pop-up's card art or
 * the billboard's image), and a Play button whose title id is only known once the player opens
 * (it waits briefly for the next /watch/<id>). A series' episodes take the art of the pop-up they
 * were clicked in. A title started without a click (a keypress, a deep link into a page that showed
 * its card, the WebKit engine's other event path) is covered by a passive scan that records each
 * card link's own image by title id. Art that can't be tied to the playing title is never guessed.
 */
export const NETFLIX_ART_PRELOAD: PagePreload = {
  name: "Netflix box art",
  func: `function () {
  var KEY = "${KEY}";
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function trim(o, n) {
    var k = Object.keys(o).filter(function (x) { return x !== "open" && x !== "pending"; });
    while (k.length > n) delete o[k.shift()];
  }
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
  var SEEN = "${SEEN}", CAP = ${SEEN_CAP};
  var seen = new Map();
  var cards = new WeakMap();
  try {
    JSON.parse(sessionStorage.getItem(SEEN) || "[]").forEach(function (p) { seen.set(p[0], p[1]); });
  } catch (e) {}
  function scan() {
    try {
      if (document.visibilityState === "hidden" || /^\\/watch\\//.test(location.pathname)) return;
      var changed = false;
      Array.prototype.forEach.call(
        document.querySelectorAll('a[href*="jbv="], a[href*="/title/"], a[href*="/watch/"]'),
        function (a) {
          var rec = cards.get(a);
          if (!rec) {
            var m = /(jbv=|\\/title\\/|\\/watch\\/)(\\d+)/.exec(a.getAttribute("href") || "");
            rec = { id: m && m[2], img: null, src: null };
            cards.set(a, rec);
          }
          if (!rec.id) return;
          if (!rec.img) rec.img = a.querySelector("img");
          var src = rec.img && https(rec.img.src);
          if (!src || src === rec.src) return;
          rec.src = src;
          seen.delete(rec.id);
          seen.set(rec.id, src);
          while (seen.size > CAP) seen.delete(seen.keys().next().value);
          changed = true;
        },
      );
      if (changed) sessionStorage.setItem(SEEN, JSON.stringify(Array.from(seen)));
    } catch (err) {}
  }
  setInterval(scan, 2000);
  document.addEventListener("click", function (e) {
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      var s = load();
      trim(s, 30);
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

/**
 * Page script defining `readTitle(id)`: the title as the player's header shows it (the series, then
 * the season and episode, then the episode's name; a film is one line). Netflix draws the header only
 * while the bar is up, so what was read is kept per title id.
 */
const READ_TITLE = `
  var TITLES = "${TITLES}";
  var readTitle = function (id) {
    var all = {};
    try { all = JSON.parse(sessionStorage.getItem(TITLES) || "{}"); } catch (e) {}
    var h = document.querySelector('[data-uia="video-title"]');
    var parts = [];
    if (h) {
      Array.prototype.forEach.call(h.children || [], function (c) {
        var t = String(c.textContent || "").replace(/\\s+/g, " ").trim();
        if (t) parts.push(t);
      });
      if (!parts.length) {
        var whole = String(h.textContent || "").replace(/\\s+/g, " ").trim();
        if (whole) parts.push(whole);
      }
    }
    if (parts.length) {
      if (Object.keys(all).length > 30) all = {};
      all[id] = { series: parts[0], text: parts.join(" \u00b7 ") };
      sessionStorage.setItem(TITLES, JSON.stringify(all));
    }
    return all[id] || null;
  };
`;

/** The title for what plays, from the player's header (remembered while the bar is hidden). */
export const NETFLIX_TITLE = `(function () {
  try {
    ${READ_TITLE}
    var m = /^\\/watch\\/(\\d+)/.exec(location.pathname);
    var t = m && readTitle(m[1]);
    return t ? t.text : null;
  } catch (e) { return null; }
})()`;

/**
 * The box art for the title on the player: what its own click recorded, else a card link seen in
 * the page, else a Play click just before it. Art is tied to a title id only (never to a name, so an
 * autoplayed episode with no id-bound art shows none). Whatever is found is stored for that id, so
 * the art stays once the card has left the scan's store.
 */
export const NETFLIX_ARTWORK = `(function () {
  try {
    var s = JSON.parse(sessionStorage.getItem("${KEY}") || "{}");
    var m = /^\\/watch\\/(\\d+)/.exec(location.pathname);
    if (!m) return null;
    var id = m[1];
    if (s[id]) return s[id];
    var art = null;
    var seen = JSON.parse(sessionStorage.getItem("${SEEN}") || "[]");
    for (var i = seen.length - 1; i >= 0; i--) if (seen[i][0] === id) { art = seen[i][1]; break; }
    if (!art && s.pending && Date.now() - s.pending.at < 30000) { art = s.pending.art; delete s.pending; }
    if (!art) return null;
    s[id] = art;
    var k = Object.keys(s).filter(function (x) { return x !== "open" && x !== "pending" && x !== id; });
    while (k.length > 30) delete s[k.shift()];
    sessionStorage.setItem("${KEY}", JSON.stringify(s));
    return art;
  } catch (e) { return null; }
})()`;

/** The title id from the player's address, or null off the player. */
export const NETFLIX_TITLE_ID = `(function () {
  var m = /^\\/watch\\/(\\d+)/.exec(location.pathname);
  return m ? m[1] : null;
})()`;
