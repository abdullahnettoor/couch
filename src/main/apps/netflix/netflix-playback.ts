import { WAKE_POINTER_SOURCE } from "../../web/pointer-wake.ts";
import type { PlaybackAdapter } from "../../web/web-app.ts";
import { NETFLIX_ARTWORK } from "./netflix-artwork.ts";

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
  var wakePointer = (${WAKE_POINTER_SOURCE});
  var reveal = async function () {
    if (barUp()) return;
    window.__couchNfRevealAt = Date.now();
    for (var i = 1; i <= 6; i++) wakePointer(i);
    await sl(400);
  };
  var menu = function () { return $("selector-audio-subtitle"); };
  var item = function (li) {
    var x = /^(audio|subtitle)-item(-selected)?-(.*)$/.exec(li.getAttribute("data-uia") || "");
    return x ? { kind: x[1], id: x[3], on: !!x[2], label: li.textContent || x[3] } : null;
  };
  var read = function (m, canSeek) {
    var out = { subtitles: [], audio: [], canSeek: canSeek };
    Array.prototype.forEach.call(m.querySelectorAll("li"), function (li) {
      var i = item(li);
      if (i) (i.kind === "audio" ? out.audio : out.subtitles).push({ id: i.id, label: i.label, on: i.on });
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
  var speedMenu = function () { return $("watch-video-speed-controls"); };
  var speedItems = function (m) {
    var out = [];
    Array.prototype.forEach.call(m.querySelectorAll("[data-uia^=playback-speed-item]"), function (li) {
      var n = parseFloat(String(li.textContent || "").replace(",", "."));
      if (n > 0) out.push({ n: n, on: /-active$/.test(li.getAttribute("data-uia") || ""), el: li });
    });
    return out;
  };
  var speedOpen = async function () {
    var m = speedMenu();
    if (m) return m;
    var b = $("control-speed");
    if (!b) return null;
    b.click();
    await sl(600);
    return speedMenu();
  };
  var closeSpeed = function (m) { closeMenu($("playback-speed") || m); };
  var speedKeep = function (items, on) {
    var c = { speeds: items.map(function (i) { return i.n; }), speed: on };
    c.key = location.pathname; c.at = Date.now(); c.ok = c.speeds.length > 0;
    window.__couchNfSpeed = c;
    return c;
  };
  var speedRead = async function () {
    var c = window.__couchNfSpeed;
    var m = speedMenu();
    if (!m) {
      if (c && c.key === location.pathname && (c.ok || Date.now() - c.at < 20000)) return c.ok ? c : null;
      if (menu()) return null;
      if (barUp() && !(Date.now() - (window.__couchNfRevealAt || 0) < 6000)) return null;
      await reveal();
      m = await speedOpen();
      if (!m) { window.__couchNfSpeed = { key: location.pathname, at: Date.now(), ok: false }; return null; }
      var open = false;
    } else open = true;
    var items = speedItems(m);
    var cur = items.filter(function (i) { return i.on; })[0];
    c = speedKeep(items, cur ? cur.n : 1);
    if (!open) closeSpeed(m);
    return c.ok ? c : null;
  };
`;

/**
 * Netflix's player breaks if the video's position is set directly, so everything goes through its
 * own controls: seek clicks the timeline, tracks and setTrack work its Audio & Subtitles menu.
 * The controls are only in the page while the bar is up, so a missing one is only believed after
 * the bar was brought up. Subtitle and audio ids are Netflix's own item names. Only /watch counts
 * as playback: browse autoplays a billboard trailer. Speed is Netflix's own speed menu (0.5 to
 * 1.5×), read with the tracks and set by clicking its items; the video's `playbackRate` is never
 * written, and a title without the control offers no speed. Its menu only closes on an Escape
 * sent to the inner `playback-speed` element.
 */
export const NETFLIX_PLAYBACK: PlaybackAdapter = {
  active: () => `/^\\/watch\\//.test(location.pathname)`,
  artwork: () => NETFLIX_ARTWORK,
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
  playPause: () =>
    `(async function(){try{${HELPERS}
  await reveal();
  var b = $("control-play-pause-pause") || $("control-play-pause-play");
  if (b) b.click();
}catch(e){}})()`,
  tracks: () =>
    `(async function(){${HELPERS}
  var base = await (async function(){try{
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
}catch(e){return { subtitles: [], audio: [], canSeek: false }}})();
  try { var sp = await speedRead(); if (sp) { base.speed = sp.speed; base.speeds = sp.speeds; } } catch (e) {}
  return base;
})()`,
  setSpeed: (speed) =>
    `(async function(){try{${HELPERS}
  var want = ${Number(speed)};
  await reveal();
  var open = !!speedMenu();
  var m = await speedOpen();
  if (!m) return;
  var items = speedItems(m);
  var hit = items.filter(function (i) { return Math.abs(i.n - want) < 0.001; })[0];
  var cur = items.filter(function (i) { return i.on; })[0];
  if (hit) { hit.el.click(); await sl(300); }
  speedKeep(items, hit ? hit.n : cur ? cur.n : 1);
  if (!open && speedMenu()) closeSpeed(speedMenu());
}catch(e){}})()`,
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
    var i = item(li);
    if (i && i.kind === kind && i.id === id) hit = li;
  });
  if (hit) { hit.click(); await sl(300); }
  var old = window.__couchNfTracks;
  var c = read(m, old && old.key === location.pathname ? old.canSeek : seekable); c.key = location.pathname; c.at = Date.now(); c.ok = true;
  window.__couchNfTracks = c;
  if (!wasOpen) closeMenu(m);
}catch(e){}})()`,
};
