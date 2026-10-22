import type { PlaybackAdapter } from "../../web/web-app.ts";

/**
 * Shared page helpers. Netflix draws its bar only while the pointer moves over the page, so each
 * script first moves a synthetic pointer to bring it up (it hides itself ~5 s later).
 */
const HELPERS = `
  var sl = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var $ = function (u) { return document.querySelector("[data-uia=" + u + "]"); };
  var fire = function (el, names, o) {
    names.forEach(function (n) {
      var C = n.indexOf("pointer") === 0 ? PointerEvent : MouseEvent;
      el.dispatchEvent(new C(n, o));
    });
  };
  var barUp = function () { return !!($("timeline") || $("control-audio-subtitle")); };
  var reveal = async function () {
    if (barUp()) return;
    var t = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || document.body;
    for (var i = 0; i < 6; i++)
      fire(t, ["pointerover", "pointermove", "mouseover", "mousemove"], {
        bubbles: true, cancelable: true, view: window,
        clientX: window.innerWidth / 2 + i * 7, clientY: window.innerHeight / 2 + i * 5, movementX: 7, movementY: 5,
      });
    await sl(400);
  };
  var menu = function () { return $("selector-audio-subtitle"); };
  var read = function (m, canSeek) {
    var out = { subtitles: [], audio: [], canSeek: canSeek };
    Array.prototype.forEach.call(m.querySelectorAll("li"), function (li) {
      var x = /^(audio|subtitle)-item(-selected)?-(.*)$/.exec(li.getAttribute("data-uia") || "");
      if (!x) return;
      (x[1] === "audio" ? out.audio : out.subtitles).push({ id: x[3], label: li.textContent || x[3], on: !!x[2] });
    });
    return out;
  };
  var closeMenu = function (m) {
    ["keydown", "keyup"].forEach(function (t) {
      m.dispatchEvent(new KeyboardEvent(t, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
    });
  };
  var openMenu = async function () {
    var m = menu();
    if (m) return m;
    var b = $("control-audio-subtitle");
    if (!b) return null;
    b.click();
    await sl(600);
    return menu();
  };
`;

/**
 * Netflix's player breaks if the video's position is set directly, so everything goes through its
 * own controls: seek clicks the timeline, tracks and setTrack work its Audio & Subtitles menu.
 * The controls are only in the page while the bar is up, so a missing one is only believed after
 * the bar was brought up. Subtitle and audio ids are Netflix's own item names. Only /watch counts
 * as playback: browse autoplays a billboard trailer.
 */
export const NETFLIX_PLAYBACK: PlaybackAdapter = {
  active: () => `/^\\/watch\\//.test(location.pathname)`,
  seek: (seconds) =>
    `(async function(){try{${HELPERS}
  await reveal();
  var tl = $("timeline"); if (!tl) return;
  var knob = $("timeline-knob");
  var total = knob ? Number(knob.getAttribute("aria-valuemax")) / 1000 : 0;
  var v = document.querySelector("video");
  if (!(total > 0)) total = v ? v.duration : 0;
  if (!(total > 0)) return;
  var r = tl.getBoundingClientRect();
  var f = Math.min(1, Math.max(0, ${Number(seconds)} / total));
  var o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width * f, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
  fire(tl, ["pointerover", "pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"], o);
}catch(e){}})()`,
  tracks: () =>
    `(async function(){try{${HELPERS}
  var key = location.pathname, c = window.__couchNfTracks;
  var out = function (x) { return { subtitles: x.subtitles, audio: x.audio, canSeek: x.canSeek }; };
  var m = menu();
  var prev = c && c.key === key ? c.canSeek : true;
  if (m) { c = read(m, prev); c.key = key; c.at = Date.now(); c.ok = true; window.__couchNfTracks = c; return out(c); }
  if (c && c.key === key && (c.ok || Date.now() - c.at < 20000)) return out(c);
  if (barUp()) return { subtitles: [], audio: [], canSeek: !!$("timeline") };
  await reveal();
  var seekable = !!$("timeline");
  m = await openMenu();
  if (m) {
    c = read(m, seekable); c.ok = true;
    closeMenu(m);
  } else c = { subtitles: [], audio: [], canSeek: !!$("timeline"), ok: false };
  c.key = key; c.at = Date.now();
  window.__couchNfTracks = c;
  return out(c);
}catch(e){return { subtitles: [], audio: [], canSeek: false }}})()`,
  setTrack: (kind, id) =>
    `(async function(){try{${HELPERS}
  var kind = ${JSON.stringify(kind === "audio" ? "audio" : "subtitle")}, id = ${JSON.stringify(id)};
  await reveal();
  var seekable = !!$("timeline") || !!menu();
  var wasOpen = !!menu();
  var m = await openMenu();
  if (!m) return;
  var hit = null;
  Array.prototype.forEach.call(m.querySelectorAll("li"), function (li) {
    var x = /^(audio|subtitle)-item(-selected)?-(.*)$/.exec(li.getAttribute("data-uia") || "");
    if (x && x[1] === kind && x[3] === id) hit = li;
  });
  if (hit) { hit.click(); await sl(300); }
  var old = window.__couchNfTracks;
  var c = read(m, old && old.key === location.pathname ? old.canSeek : seekable); c.key = location.pathname; c.at = Date.now(); c.ok = true;
  window.__couchNfTracks = c;
  if (!wasOpen) closeMenu(m);
}catch(e){}})()`,
};
